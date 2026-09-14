import { z } from "zod";
import { registerEventType } from "@core/data/rules/events";
import type { EventTypeDefinition } from "@core/lib/rules/types";
import {
  buildCompanyVerificationNotificationProps,
  buildDocumentLabelNotificationProps,
  buildIncomingDocumentNotificationProps,
  buildOutgoingDocumentNotificationProps,
  buildPeppolDocumentEmailAttachments,
} from "@peppol/data/email/document-notification-props";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import {
  STORED_DOCUMENT_TYPE_KEYS,
  type StoredDocumentType,
} from "@peppol/utils/type-repository/document-types/keys";
import {
  deliveryChannels,
  deliveryFailureCategories,
  deliveryStatuses,
} from "@peppol/db/schema";

const receivedDocumentTypes = STORED_DOCUMENT_TYPE_KEYS;

/**
 * English labels for the document type enum, used by the rule editor's value
 * dropdowns. The enum values are code identifiers, so they are not translation
 * keys — the labels are, and they come from the same place the rest of the UI
 * takes them from.
 */
const documentTypeLabels = Object.fromEntries(
  receivedDocumentTypes.map((type) => [type, getDocumentTypeTitle(type)]),
) as Record<StoredDocumentType, string>;

const verificationStatuses = ["verified", "rejected", "error"] as const;

const verificationStatusLabels: Record<(typeof verificationStatuses)[number], string> = {
  verified: "Verified",
  rejected: "Rejected",
  error: "Error",
};

type ConditionField = EventTypeDefinition["conditionFields"][number];

const documentTypeField: ConditionField = {
  path: "payload.docType",
  label: "Document type",
  valueType: "enum",
  operators: ["eq", "neq", "in", "notIn"],
  enumValues: [...receivedDocumentTypes],
  enumLabels: documentTypeLabels,
};

const documentReceivedPayloadSchema = z.object({
  companyId: z.string(),
  docType: z.enum(receivedDocumentTypes),
  senderId: z.string(),
  receiverId: z.string(),
  peppolMessageId: z.string().nullable().optional(),
  peppolConversationId: z.string().nullable().optional(),
  envelopeId: z.string().nullable().optional(),
  countryC1: z.string(),
});

const documentSentPayloadSchema = z.object({
  companyId: z.string(),
  docType: z.enum(receivedDocumentTypes),
  senderId: z.string(),
  receiverId: z.string().nullable(),
  peppolMessageId: z.string().nullable().optional(),
  peppolConversationId: z.string().nullable().optional(),
  envelopeId: z.string().nullable().optional(),
  countryC1: z.string(),
  // Where the document stood when it was recorded: delivered when the receipt came
  // with the send, pending when the access point confirms later, null for a report.
  deliveryStatus: z.enum(deliveryStatuses).nullable().optional(),
});

const documentLabelPayloadSchema = z.object({
  companyId: z.string(),
  labelId: z.string(),
  labelExternalId: z.string().nullable().optional(),
  docType: z.enum(receivedDocumentTypes),
  senderId: z.string(),
  // Label events are emitted from stored transmitted documents, whose receiverId
  // can be null for non-Peppol or email-only document rows.
  receiverId: z.string().nullable(),
});

const reportingStatuses = [
  "accepted",
  "pending_rectificative",
  "filed",
  "filed_rectificative",
  "superseded",
  "rejected",
] as const;

const reportingStatusLabels: Record<(typeof reportingStatuses)[number], string> = {
  accepted: "Accepted",
  pending_rectificative: "Awaiting corrective filing",
  filed: "Filed",
  filed_rectificative: "Filed by corrective filing",
  superseded: "Superseded",
  rejected: "Rejected",
};

const documentReportingStatusPayloadSchema = z.object({
  companyId: z.string(),
  docType: z.string(),
  reportingStatus: z.enum(reportingStatuses),
  previousReportingStatus: z.enum(reportingStatuses),
  periodEnd: z.string().nullable().optional(),
  submissionId: z.string().nullable().optional(),
  outcomeCode: z.string().nullable().optional(),
});

const deliveryStatusLabels: Record<(typeof deliveryStatuses)[number], string> = {
  pending: "Pending",
  delivered: "Delivered",
  failed: "Failed",
};

const deliveryFailureCategoryLabels: Record<(typeof deliveryFailureCategories)[number], string> = {
  recipient_not_found: "Recipient not found",
  document_not_supported: "Document not supported by recipient",
  validation: "Validation",
  transport: "Transport",
  recipient_rejected: "Rejected by recipient",
  duplicate: "Duplicate",
  other: "Other",
};

// One delivery of a document moved to a new status: a channel confirmed arrival, or
// failed a document it had accepted. Sent once per change.
const documentDeliveryStatusPayloadSchema = z.object({
  companyId: z.string(),
  docType: z.string(),
  senderId: z.string(),
  receiverId: z.string().nullable(),
  envelopeId: z.string().nullable().optional(),
  deliveryId: z.string(),
  channel: z.enum(deliveryChannels),
  address: z.string(),
  status: z.enum(deliveryStatuses),
  // Null for a delivery that did not exist before, such as an email sent as the
  // fallback for a Peppol transmission that failed after it was accepted.
  previousStatus: z.enum(deliveryStatuses).nullable(),
  failure: z
    .object({
      category: z.enum(deliveryFailureCategories),
      message: z.string().nullable(),
      providerCode: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

const companyVerificationPayloadSchema = z.object({
  companyId: z.string(),
  status: z.enum(verificationStatuses),
  errorMessage: z.string().nullable().optional(),
});

const documentEmailAttachments = [
  { key: "embeddedAttachments", label: "Embedded attachments" },
  { key: "xmlDocument", label: "XML document" },
  { key: "autoGeneratedPdf", label: "Auto-generated PDF" },
  { key: "documentJson", label: "document.json" },
];

let registered = false;

export function registerPeppolEventTypes() {
  if (registered) {
    return;
  }

  registered = true;

  registerEventType({
    type: "peppol.document.received.v1",
    aggregateType: "peppol.document",
    payload: documentReceivedPayloadSchema,
    conditionFields: [
      { path: "payload.companyId", label: "Company", valueType: "string", operators: ["eq", "neq", "in"], picker: "company" },
      documentTypeField,
      { path: "payload.senderId", label: "Sender address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
      { path: "payload.receiverId", label: "Receiver address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
    ],
    webhook: {
      eventType: "document.received",
      project: (event) => ({
        eventType: "document.received",
        documentId: event.aggregateId,
        teamId: event.teamId,
        companyId: (event.payload as z.infer<typeof documentReceivedPayloadSchema>).companyId,
      }),
    },
    email: {
      template: "document-incoming-notification",
      attachments: documentEmailAttachments,
      buildProps: buildIncomingDocumentNotificationProps,
      buildAttachments: buildPeppolDocumentEmailAttachments,
    },
    ui: {
      label: "Document received",
      description: "A document was received for a company",
      group: "Documents",
    },
  });

  registerEventType({
    type: "peppol.document.sent.v1",
    aggregateType: "peppol.document",
    payload: documentSentPayloadSchema,
    conditionFields: [
      { path: "payload.companyId", label: "Company", valueType: "string", operators: ["eq", "neq", "in"], picker: "company" },
      documentTypeField,
      { path: "payload.senderId", label: "Sender address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
      { path: "payload.receiverId", label: "Receiver address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
      { path: "payload.deliveryStatus", label: "Delivery status", valueType: "enum", operators: ["eq", "neq", "in", "notIn"], enumValues: [...deliveryStatuses], enumLabels: deliveryStatusLabels },
    ],
    webhook: {
      eventType: "document.sent",
      project: (event) => {
        const payload = event.payload as z.infer<typeof documentSentPayloadSchema>;
        return {
          eventType: "document.sent",
          documentId: event.aggregateId,
          teamId: event.teamId,
          companyId: payload.companyId,
          deliveryStatus: payload.deliveryStatus ?? null,
        };
      },
    },
    email: {
      template: "document-outgoing-notification",
      attachments: documentEmailAttachments,
      buildProps: buildOutgoingDocumentNotificationProps,
      buildAttachments: buildPeppolDocumentEmailAttachments,
    },
    ui: {
      label: "Document sent",
      description: "A document was handed to the network or mailed; its delivery status says whether the recipient has confirmed it yet",
      group: "Documents",
    },
  });

  registerEventType({
    type: "peppol.document.label.assigned.v1",
    aggregateType: "peppol.document",
    payload: documentLabelPayloadSchema,
    conditionFields: [
      { path: "payload.companyId", label: "Company", valueType: "string", operators: ["eq", "neq", "in"], picker: "company" },
      { path: "payload.labelId", label: "Label", valueType: "string", operators: ["eq", "neq", "in"], picker: "label" },
      { path: "payload.labelExternalId", label: "Label external ID", valueType: "string", operators: ["eq", "neq", "in"] },
      documentTypeField,
      { path: "payload.senderId", label: "Sender address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
      { path: "payload.receiverId", label: "Receiver address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
    ],
    webhook: {
      eventType: "document.label.assigned",
      project: (event) => {
        const payload = event.payload as z.infer<typeof documentLabelPayloadSchema>;
        return {
          eventType: "document.label.assigned",
          documentId: event.aggregateId,
          teamId: event.teamId,
          companyId: payload.companyId,
          labelId: payload.labelId,
        };
      },
    },
    email: {
      template: "document-label-assigned-notification",
      buildProps: buildDocumentLabelNotificationProps,
      attachments: documentEmailAttachments,
      buildAttachments: buildPeppolDocumentEmailAttachments,
    },
    ui: {
      label: "Document label assigned",
      group: "Documents",
    },
  });

  registerEventType({
    type: "peppol.document.label.unassigned.v1",
    aggregateType: "peppol.document",
    payload: documentLabelPayloadSchema,
    conditionFields: [
      { path: "payload.companyId", label: "Company", valueType: "string", operators: ["eq", "neq", "in"], picker: "company" },
      { path: "payload.labelId", label: "Label", valueType: "string", operators: ["eq", "neq", "in"], picker: "label" },
      { path: "payload.labelExternalId", label: "Label external ID", valueType: "string", operators: ["eq", "neq", "in"] },
      documentTypeField,
      { path: "payload.senderId", label: "Sender address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
      { path: "payload.receiverId", label: "Receiver address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
    ],
    webhook: {
      eventType: "document.label.unassigned",
      project: (event) => {
        const payload = event.payload as z.infer<typeof documentLabelPayloadSchema>;
        return {
          eventType: "document.label.unassigned",
          documentId: event.aggregateId,
          teamId: event.teamId,
          companyId: payload.companyId,
          labelId: payload.labelId,
        };
      },
    },
    email: {
      template: "document-label-unassigned-notification",
      buildProps: buildDocumentLabelNotificationProps,
      attachments: documentEmailAttachments,
      buildAttachments: buildPeppolDocumentEmailAttachments,
    },
    ui: {
      label: "Document label unassigned",
      group: "Documents",
    },
  });

  registerEventType({
    type: "peppol.document.delivery_status.v1",
    aggregateType: "peppol.document",
    payload: documentDeliveryStatusPayloadSchema,
    conditionFields: [
      { path: "payload.companyId", label: "Company", valueType: "string", operators: ["eq", "neq", "in"], picker: "company" },
      documentTypeField,
      { path: "payload.senderId", label: "Sender address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
      { path: "payload.receiverId", label: "Receiver address", valueType: "string", operators: ["eq", "neq", "in", "notIn"] },
      { path: "payload.channel", label: "Channel", valueType: "enum", operators: ["eq", "neq"], enumValues: [...deliveryChannels] },
      { path: "payload.status", label: "Delivery status", valueType: "enum", operators: ["eq", "neq", "in", "notIn"], enumValues: [...deliveryStatuses], enumLabels: deliveryStatusLabels },
      { path: "payload.failure.category", label: "Failure category", valueType: "enum", operators: ["eq", "neq", "in", "notIn"], enumValues: [...deliveryFailureCategories], enumLabels: deliveryFailureCategoryLabels },
    ],
    webhook: {
      eventType: "document.delivery_status_changed",
      project: (event) => {
        const payload = event.payload as z.infer<typeof documentDeliveryStatusPayloadSchema>;
        return {
          eventType: "document.delivery_status_changed",
          documentId: event.aggregateId,
          teamId: event.teamId,
          companyId: payload.companyId,
          deliveryId: payload.deliveryId,
          channel: payload.channel,
          address: payload.address,
          status: payload.status,
          previousStatus: payload.previousStatus,
          failure: payload.failure ?? null,
        };
      },
    },
    ui: {
      label: "Delivery status changed",
      description: "A delivery of a sent document was confirmed, or failed after the channel had accepted it",
      group: "Documents",
    },
  });

  registerEventType({
    type: "peppol.document.reporting_status.v1",
    aggregateType: "peppol.document",
    payload: documentReportingStatusPayloadSchema,
    conditionFields: [
      { path: "payload.companyId", label: "Company", valueType: "string", operators: ["eq", "neq", "in"], picker: "company" },
      { path: "payload.reportingStatus", label: "Reporting status", valueType: "enum", operators: ["eq", "neq", "in", "notIn"], enumValues: [...reportingStatuses], enumLabels: reportingStatusLabels },
      { path: "payload.outcomeCode", label: "Outcome code", valueType: "string", operators: ["eq", "neq", "exists"] },
    ],
    webhook: {
      eventType: "document.reporting_status_changed",
      project: (event) => {
        const payload = event.payload as z.infer<typeof documentReportingStatusPayloadSchema>;
        return {
          eventType: "document.reporting_status_changed",
          documentId: event.aggregateId,
          teamId: event.teamId,
          companyId: payload.companyId,
          reportingStatus: payload.reportingStatus,
          previousReportingStatus: payload.previousReportingStatus,
          periodEnd: payload.periodEnd ?? null,
          submissionId: payload.submissionId ?? null,
          outcomeCode: payload.outcomeCode ?? null,
        };
      },
    },
    ui: {
      label: "Report status changed",
      description: "A French e-reporting report was filed, superseded or rejected by the tax administration",
      group: "Documents",
    },
  });

  registerEventType({
    type: "peppol.company.verification.v1",
    aggregateType: "peppol.company",
    payload: companyVerificationPayloadSchema,
    conditionFields: [
      { path: "payload.companyId", label: "Company", valueType: "string", operators: ["eq", "neq", "in"], picker: "company" },
      { path: "payload.status", label: "Verification status", valueType: "enum", operators: ["eq", "neq", "in", "notIn"], enumValues: [...verificationStatuses], enumLabels: verificationStatusLabels },
      { path: "payload.errorMessage", label: "Error message", valueType: "string", operators: ["eq", "neq", "exists"] },
    ],
    webhook: {
      eventType: "company.verification",
      project: (event) => {
        const payload = event.payload as z.infer<typeof companyVerificationPayloadSchema>;
        return Object.fromEntries(
          Object.entries({
            eventType: "company.verification",
            teamId: event.teamId,
            companyId: payload.companyId,
            status: payload.status,
            errorMessage: payload.errorMessage ?? undefined,
          }).filter(([, value]) => value !== undefined)
        );
      },
    },
    email: {
      template: "company-verification-notification",
      buildProps: buildCompanyVerificationNotificationProps,
    },
    ui: {
      label: "Company verification",
      description: "A company verification finished",
      group: "Companies",
    },
  });
}
