import { audit } from "@core/lib/audit";
import { publishEvent } from "@core/data/rules/events";
import type { Company } from "@peppol/data/companies";
import {
  buildOutgoingDocumentRow,
  buildOutgoingTransferEvents,
  deliveryFacts,
  type OutgoingDocumentDelivery,
  type OutgoingDocumentPayload,
  type OutgoingDocumentStorage,
} from "@peppol/data/outgoing-document-row";
import {
  uploadDocumentOriginalPayload,
  type OriginalPayloadContainerFormat,
} from "@peppol/data/offload/storage";
import { sendOutgoingDocumentNotifications } from "@peppol/data/send-document-notifications";
import { transferEvents, transmittedDocuments } from "@peppol/db/schema";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { db } from "@recommand/db";
import type { Context } from "@recommand/lib/api";

export type {
  OutgoingDocumentDelivery,
  OutgoingDocumentPayload,
} from "@peppol/data/outgoing-document-row";

/**
 * Persists an outgoing document and runs everything that follows from it: the sent
 * event, billing, notification emails, and the audit trail. Shared by every endpoint
 * that produces an outgoing document, so a document reaches the platform the same way
 * whether it was transmitted over Peppol or filed with a tax administration.
 */
export async function recordOutgoingDocument(options: {
  c: Context<any>;
  id: string;
  teamId: string;
  company: Company;
  isPlayground?: boolean;
  inputFormat: string;
  document: OutgoingDocumentPayload;
  delivery: OutgoingDocumentDelivery;
  originalPayload?: {
    content: Buffer;
    containerFormat: Exclude<OriginalPayloadContainerFormat, "none">;
  } | null;
}): Promise<{ id: string }> {
  const { c, id, teamId, company, document, delivery } = options;
  const facts = deliveryFacts(delivery);

  const storage: OutgoingDocumentStorage = {
    createdAt: new Date(),
    s3KeyPrefix: null,
    originalPayloadLocation: "none",
    originalPayloadContainerFormat: "none",
  };

  if (options.originalPayload) {
    try {
      storage.s3KeyPrefix = await uploadDocumentOriginalPayload(
        {
          id,
          teamId,
          companyId: company.id,
          createdAt: storage.createdAt,
        },
        options.originalPayload.content,
        options.originalPayload.containerFormat
      );
      storage.originalPayloadLocation = "s3";
      storage.originalPayloadContainerFormat =
        options.originalPayload.containerFormat;
    } catch (error) {
      console.error("Failed to upload original payload:", error);
      sendSystemAlert(
        "Original Payload Upload Failed",
        `Failed to upload original payload. Error: \`\`\`\n${error}\n\`\`\``,
        "error"
      );
    }
  }

  const transmittedDocument = await db
    .insert(transmittedDocuments)
    .values(
      buildOutgoingDocumentRow({
        id,
        teamId,
        company,
        document,
        delivery,
        storage,
      })
    )
    .returning({ id: transmittedDocuments.id })
    .then((rows) => rows[0]);

  await publishEvent("peppol.document.sent.v1", {
    teamId,
    aggregateType: "peppol.document",
    aggregateId: transmittedDocument.id,
    idempotencyKey: `peppol.document.sent:${transmittedDocument.id}`,
    payload: {
      companyId: company.id,
      docType: document.type,
      senderId: document.senderId,
      receiverId: document.receiverId,
      peppolMessageId: facts.peppolMessageId,
      peppolConversationId: facts.peppolConversationId,
      envelopeId: facts.envelopeId,
      countryC1: document.countryC1,
    },
  });

  // Create a new transferEvent for billing
  if (!options.isPlayground) {
    const te = buildOutgoingTransferEvents({
      teamId,
      companyId: company.id,
      transmittedDocumentId: transmittedDocument.id,
      delivery,
    });
    if (te.length > 0) {
      await db.insert(transferEvents).values(te);
    }
  }

  // Send notification emails to configured addresses
  try {
    await sendOutgoingDocumentNotifications({
      transmittedDocumentId: transmittedDocument.id,
      companyId: company.id,
      companyName: company.name,
      type: document.type,
      parsedDocument: document.parsed,
      xmlDocument: document.xml,
      isPlayground: options.isPlayground,
    });
  } catch (error) {
    console.error("Failed to send outgoing document notifications:", error);
    sendSystemAlert(
      "Document Notification Sending Failed",
      `Failed to send outgoing document notification for document ${transmittedDocument.id}.`,
      "error"
    );
  }

  await audit(c, {
    action: "create",
    subsystem: "peppol.documents",
    objectType: "peppol.document",
    objectId: transmittedDocument.id,
    teamId,
    after: {
      companyId: company.id,
      direction: "outgoing",
      type: document.type,
      sentOverPeppol: facts.sentOverPeppol,
      sentOverEmail: facts.sentOverEmail,
    },
    metadata: {
      inputFormat: options.inputFormat,
      senderId: document.senderId,
      receiverId: document.receiverId,
      docTypeId: document.docTypeId,
      processId: document.processId,
      peppolMessageId: facts.peppolMessageId,
      envelopeId: facts.envelopeId,
      externalReferenceId: facts.externalReferenceId,
    },
  });

  return transmittedDocument;
}
