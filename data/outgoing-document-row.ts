import type { Company } from "@peppol/data/companies";
import type { SendAs4Response } from "@peppol/data/access-point-providers";
import type { DeliveryFailure, DeliveryStatus } from "@peppol/data/deliveries/model";
import type { EmailFallbackRequest } from "@peppol/data/deliveries/email-fallback";
import { accessPointConfirmsDeliveryOnSend } from "@peppol/data/peppol-providers";
import {
  parsedHasAttachments,
  type OriginalPayloadContainerFormat,
} from "@peppol/data/offload/storage";
import type {
  documentDeliveries,
  transferEvents,
  transmittedDocuments,
} from "@peppol/db/schema";
import type { ParsedDocument } from "@peppol/utils/document-filename";
import type { ParsedOrUnknownDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { isBillableDocument } from "@peppol/utils/type-repository/document-types/billing";
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
      /**
       * Why the Peppol transmission was refused, when it was and the document was
       * still stored because an email fallback applied. Null or absent when the
       * document went over Peppol or was never addressed on the network.
       */
      peppolFailure?: DeliveryFailure | null;
      /**
       * The email to send if the transmission fails after the access point accepted
       * it, kept with the document until the outcome is known. Null when no such
       * email was asked for, or when it went out in the send itself.
       */
      emailFallback?: EmailFallbackRequest | null;
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
  type: ParsedOrUnknownDocumentType;
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
    peppolFailure: isReporting ? null : delivery.peppolFailure ?? null,
    emailFallback: isReporting ? null : delivery.emailFallback ?? null,
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
  const documentType = getDocumentType(document.type);
  const counterparties = documentType && document.parsed
    ? documentType.extractCounterparties(document.parsed)
    : { senderName: null, receiverName: null };
  const documentNumber = documentType && document.parsed
    ? documentType.extractDocumentNumber(document.parsed)
    : null;
  const documentSearchableText = documentType && document.parsed
    ? documentType.extractSearchableText(document.parsed)
    : "";
  const searchText = [
    id,
    document.senderId,
    document.receiverId,
    document.docTypeId,
    document.processId,
    document.countryC1,
    documentSearchableText,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

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
    emailFallback: facts.emailFallback,

    type: document.type,
    parsed: document.parsed,
    validation: document.validation,
    ...counterparties,
    documentNumber,
    searchText,

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
 * transmission, one per email recipient, and one per filed report. A document
 * that is not billable (a transport receipt, a platform-level lifecycle status)
 * produces none, however it left the platform.
 */
export function buildOutgoingTransferEvents(options: {
  teamId: string;
  companyId: string;
  transmittedDocumentId: string;
  document: Pick<OutgoingDocumentPayload, "type" | "parsed">;
  delivery: OutgoingDocumentDelivery;
}): (typeof transferEvents.$inferInsert)[] {
  if (!isBillableDocument(options.document.type, options.document.parsed)) {
    return [];
  }
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

/**
 * Builds the delivery rows for an outgoing document: one `peppol` delivery when the
 * document was addressed on the network, and one `email` delivery per address it
 * was mailed to. A filed report has no recipient and gets none.
 *
 * A Peppol delivery starts out `delivered` when the access point returned the
 * recipient's receipt in the send itself, which our own access point and a
 * simulated send both do, and `pending` when the access point only reports the
 * outcome later. A transmission that was refused before it left, with the document
 * stored because an email fallback applied, is a `failed` delivery with the reason
 * the refusal gave. Email deliveries start out `pending`: the mail was accepted for
 * delivery, and nothing confirms its arrival yet.
 */
export function buildOutgoingDocumentDeliveries(options: {
  transmittedDocumentId: string;
  teamId: string;
  company: Pick<Company, "id" | "accessPointProvider">;
  document: Pick<OutgoingDocumentPayload, "receiverId">;
  delivery: OutgoingDocumentDelivery;
  useTestNetwork: boolean;
  now?: Date;
}): (typeof documentDeliveries.$inferInsert)[] {
  const { company, document, useTestNetwork } = options;
  const now = options.now ?? new Date();
  const facts = deliveryFacts(options.delivery);
  if (facts.isReporting) {
    return [];
  }

  const base = {
    transmittedDocumentId: options.transmittedDocumentId,
    teamId: options.teamId,
    companyId: company.id,
    statusChangedAt: now,
    useTestNetwork,
  };

  const rows: (typeof documentDeliveries.$inferInsert)[] = [];
  if (document.receiverId) {
    // A transmission the access point recorded has a transaction of its own; a
    // simulated one has neither a transaction nor a provider.
    const transmitted = options.delivery.kind === "peppol" && options.delivery.as4Response !== null;
    let status: DeliveryStatus;
    if (!facts.sentOverPeppol) {
      status = "failed";
    } else if (transmitted && !accessPointConfirmsDeliveryOnSend(company.accessPointProvider)) {
      status = "pending";
    } else {
      status = "delivered";
    }
    const failure = status === "failed" ? facts.peppolFailure ?? { category: "other", message: null, providerCode: null } : null;
    rows.push({
      ...base,
      channel: "peppol",
      address: document.receiverId,
      status,
      failureCategory: failure?.category ?? null,
      failureMessage: failure?.message ?? null,
      failureProviderCode: failure?.providerCode ?? null,
      provider: transmitted ? company.accessPointProvider : null,
      providerTransactionId: facts.apTransactionId,
    });
  }
  for (const address of facts.emailRecipients) {
    rows.push({
      ...base,
      channel: "email",
      address,
      status: "pending",
    });
  }
  return rows;
}
