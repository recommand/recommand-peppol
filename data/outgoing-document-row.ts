import type { Company } from "@peppol/data/companies";
import type { SendAs4Response } from "@peppol/data/access-point-providers";
import {
  parsedHasAttachments,
  type OriginalPayloadContainerFormat,
} from "@peppol/data/offload/storage";
import type { transferEvents, transmittedDocuments } from "@peppol/db/schema";
import type { ParsedDocument } from "@peppol/utils/document-filename";
import type { SupportedDocumentType } from "@peppol/utils/document-types";
import { getTransmittedDocumentSearchFields } from "@peppol/utils/transmitted-document-search";
import type { ValidationResponse } from "@peppol/types/validation";

/**
 * How an outgoing document left the platform. Peppol documents are transmitted to a
 * recipient (over AS4, over email, or both); reports are filed with a tax
 * administration and have no recipient, no XML, and no AS4 response.
 */
export type OutgoingDocumentDelivery =
  | {
      kind: "peppol";
      sentPeppol: boolean;
      emailRecipients: string[];
      as4Response: SendAs4Response | null;
    }
  | {
      kind: "reporting";
      externalReferenceId: string;
    };

export type OutgoingDocumentPayload = {
  senderId: string;
  receiverId: string | null;
  docTypeId: string;
  processId: string;
  countryC1: string;
  type: SupportedDocumentType;
  parsed: ParsedDocument | null;
  xml: string | null;
  validation?: ValidationResponse;
};

export type OutgoingDocumentStorage = {
  createdAt: Date;
  s3KeyPrefix: string | null;
  originalPayloadLocation: "none" | "s3";
  originalPayloadContainerFormat: OriginalPayloadContainerFormat;
};

/**
 * Normalizes a delivery into the fields the row, the event and the audit trail all
 * need, so the two delivery kinds are interpreted in exactly one place.
 */
export function deliveryFacts(delivery: OutgoingDocumentDelivery) {
  const isReporting = delivery.kind === "reporting";
  const as4Response = isReporting ? null : delivery.as4Response;
  const emailRecipients = isReporting ? [] : delivery.emailRecipients;

  return {
    isReporting,
    emailRecipients,
    sentOverPeppol: isReporting ? false : delivery.sentPeppol,
    sentOverEmail: emailRecipients.length > 0,
    externalReferenceId: isReporting ? delivery.externalReferenceId : null,
    peppolMessageId: as4Response?.peppolMessageId ?? null,
    peppolConversationId: as4Response?.peppolConversationId ?? null,
    receivedPeppolSignalMessage: as4Response?.receivedPeppolSignalMessage ?? null,
    envelopeId: as4Response?.sbdhInstanceIdentifier ?? null,
    apTransactionId: as4Response?.apTransactionId ?? null,
  };
}

/**
 * Builds the transmitted document row for an outgoing document. Kept separate from
 * the write so the row shape can be asserted without a database.
 */
export function buildOutgoingDocumentRow(options: {
  id: string;
  teamId: string;
  company: Company;
  document: OutgoingDocumentPayload;
  delivery: OutgoingDocumentDelivery;
  storage: OutgoingDocumentStorage;
}): typeof transmittedDocuments.$inferInsert {
  const { id, teamId, company, document, storage } = options;
  const facts = deliveryFacts(options.delivery);

  return {
    id,
    teamId,
    companyId: company.id,
    createdAt: storage.createdAt,
    direction: "outgoing",
    senderId: document.senderId,
    receiverId: document.receiverId,
    docTypeId: document.docTypeId,
    processId: document.processId,
    countryC1: document.countryC1,
    accessPointProvider: company.accessPointProvider,
    smpProvider: company.smpProvider,
    xml: document.xml,
    xmlLocation: document.xml != null ? "db" : "none",
    attachmentsLocation: parsedHasAttachments(document.parsed) ? "db" : "none",
    originalPayloadLocation: storage.originalPayloadLocation,
    originalPayloadContainerFormat: storage.originalPayloadContainerFormat,
    s3KeyPrefix: storage.s3KeyPrefix,

    sentOverPeppol: facts.sentOverPeppol,
    sentOverEmail: facts.sentOverEmail,
    emailRecipients: facts.emailRecipients,

    type: document.type,
    parsed: document.parsed,
    validation: document.validation,
    ...getTransmittedDocumentSearchFields({
      id,
      senderId: document.senderId,
      receiverId: document.receiverId,
      docTypeId: document.docTypeId,
      processId: document.processId,
      countryC1: document.countryC1,
      type: document.type,
      parsedDocument: document.parsed,
    }),

    peppolMessageId: facts.peppolMessageId,
    peppolConversationId: facts.peppolConversationId,
    receivedPeppolSignalMessage: facts.receivedPeppolSignalMessage,
    envelopeId: facts.envelopeId,
    apTransactionId: facts.apTransactionId,
    externalReferenceId: facts.externalReferenceId,
  };
}

/**
 * Builds the billable transfer events for an outgoing document: one per Peppol
 * transmission, one per email recipient, and one per filed report.
 */
export function buildOutgoingTransferEvents(options: {
  teamId: string;
  companyId: string;
  transmittedDocumentId: string;
  delivery: OutgoingDocumentDelivery;
}): (typeof transferEvents.$inferInsert)[] {
  const facts = deliveryFacts(options.delivery);
  const base = {
    teamId: options.teamId,
    companyId: options.companyId,
    direction: "outgoing",
    transmittedDocumentId: options.transmittedDocumentId,
  } as const;

  const events: (typeof transferEvents.$inferInsert)[] = [];
  if (facts.sentOverPeppol) {
    events.push({ ...base, type: "peppol" });
  }
  for (const _ of facts.emailRecipients) {
    events.push({ ...base, type: "email" });
  }
  if (facts.isReporting) {
    events.push({ ...base, type: "reporting" });
  }
  return events;
}
