import { audit, writeAuditEvent, type AuditEventInput } from "@core/lib/audit";
import { publishEvent } from "@core/data/rules/events";
import type { Company } from "@peppol/data/companies";
import {
  buildOutgoingDocumentDeliveries,
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
import {
  applyStagedDeliveryReport,
  insertDocumentDeliveries,
  listDocumentDeliveries,
  summarizeDeliveryStatus,
  type DocumentDelivery,
} from "@peppol/data/deliveries";
import { sendOutgoingDocumentNotifications } from "@peppol/data/send-document-notifications";
import { transferEvents, transmittedDocuments } from "@peppol/db/schema";
import { isUniqueViolation } from "@peppol/utils/db-errors";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { db } from "@recommand/db";
import { eq } from "drizzle-orm";
import type { Context } from "@recommand/lib/api";

export type {
  OutgoingDocumentDelivery,
  OutgoingDocumentPayload,
} from "@peppol/data/outgoing-document-row";

export type RecordedOutgoingDocument = {
  id: string;
  /**
   * The document's deliveries as read back after recording, so a report that overtook
   * the send is reflected whichever path applied it. A snapshot: a later report
   * changes the database and notifies the owner, not this value.
   */
  deliveries: DocumentDelivery[];
};

/**
 * Persists an outgoing document with its deliveries and runs everything that follows
 * from it: the sent event, billing, notification emails, and the audit trail. Shared
 * by every endpoint that produces an outgoing document, so a document reaches the
 * platform the same way whether it was transmitted over Peppol or filed with a tax
 * administration.
 */
export async function recordOutgoingDocument(options: {
  /** The request that produced the document, for the audit trail. Null when a
   * background worker records a document an access point sent on our behalf. */
  c: Context<any> | null;
  id: string;
  teamId: string;
  company: Company;
  isPlayground?: boolean;
  /** Whether the document went over the Peppol test network, for the deliveries. */
  useTestNetwork?: boolean;
  inputFormat: string;
  document: OutgoingDocumentPayload;
  delivery: OutgoingDocumentDelivery;
  originalPayload?: {
    content: Buffer;
    containerFormat: Exclude<OriginalPayloadContainerFormat, "none">;
  } | null;
}): Promise<RecordedOutgoingDocument> {
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

  // The document and its deliveries are one write: a document never exists without
  // the deliveries that say where it stands.
  let transmittedDocument: RecordedOutgoingDocument;
  try {
    transmittedDocument = await db.transaction(async (tx) => {
      const [inserted] = await tx
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
        .returning({ id: transmittedDocuments.id });
      const deliveries = await insertDocumentDeliveries(
        tx,
        buildOutgoingDocumentDeliveries({
          transmittedDocumentId: inserted!.id,
          teamId,
          company,
          document,
          delivery,
          useTestNetwork: options.useTestNetwork ?? false,
          now: storage.createdAt,
        })
      );
      return { id: inserted!.id, deliveries };
    });
  } catch (error) {
    // ap_transaction_id is unique, so a conflict means this exact transaction was
    // already recorded from the access point's report of it (see data/provider-sent),
    // which only happens when that report could not be matched to this send's envelope
    // claim. Everything that follows from the document has then already happened, so
    // this returns what is there instead of failing a send whose document did leave
    // the platform.
    // external_reference_id is unique too: a report retried under the same
    // reference is the same filing, and two concurrent retries must end up with the
    // one document the first of them recorded. That is expected, not alarming.
    if (facts.externalReferenceId && isUniqueViolation(error)) {
      const existingFiling = await db
        .select({ id: transmittedDocuments.id })
        .from(transmittedDocuments)
        .where(eq(transmittedDocuments.externalReferenceId, facts.externalReferenceId))
        .limit(1)
        .then((rows) => rows[0]);
      if (existingFiling) {
        return { ...existingFiling, deliveries: await listDocumentDeliveries(existingFiling.id) };
      }
    }
    const existing =
      facts.apTransactionId && isUniqueViolation(error)
        ? await db
            .select({ id: transmittedDocuments.id })
            .from(transmittedDocuments)
            .where(eq(transmittedDocuments.apTransactionId, facts.apTransactionId))
            .limit(1)
            .then((rows) => rows[0])
        : undefined;
    if (!existing) {
      throw error;
    }
    sendSystemAlert(
      "Outgoing Document Already Recorded",
      `Transaction ${facts.apTransactionId} was already recorded as document ${existing.id} when the sending pipeline tried to record it. ` +
        `The access point's report of this transaction was not matched to its envelope claim.`,
      "warning"
    );
    return { ...existing, deliveries: await listDocumentDeliveries(existing.id) };
  }

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
      // As recorded with the document: pending when the access point confirms
      // later, delivered when the receipt came with the send, null for a report.
      deliveryStatus: summarizeDeliveryStatus(
        transmittedDocument.deliveries.map((delivery) => delivery.status)
      ),
    },
  });

  // Create a new transferEvent for billing
  if (!options.isPlayground) {
    const te = buildOutgoingTransferEvents({
      teamId,
      companyId: company.id,
      transmittedDocumentId: transmittedDocument.id,
      document,
      delivery,
    });
    if (te.length > 0) {
      await db.insert(transferEvents).values(te);
    }
  }

  // The access point may already have reported what became of this transaction, if
  // its report overtook the send that produced the document. That report is applied
  // now so the delivery is never left pending; nothing above is undone, the document
  // did leave the platform and its transmission was made.
  if (facts.apTransactionId) {
    try {
      await applyStagedDeliveryReport(facts.apTransactionId);
    } catch (error) {
      console.error("Failed to apply a staged delivery report:", error);
      sendSystemAlert(
        "Delivery Report Not Applied",
        `Could not check for a delivery report for transaction ${facts.apTransactionId} of document ${transmittedDocument.id}.`,
        "error"
      );
    }
  }

  // The deliveries are read back rather than returned as inserted: a report may have
  // been applied in the meantime by whoever got to it first, this call or the webhook
  // that received it, and the response should say what the database says. It is a
  // snapshot as of this read; a report that arrives later reaches the owner through
  // the delivery status event, not through this response.
  try {
    transmittedDocument.deliveries = await listDocumentDeliveries(transmittedDocument.id);
  } catch (error) {
    console.error("Failed to read back the deliveries of a recorded document:", error);
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

  const auditEvent: AuditEventInput = {
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
  };
  if (c) {
    await audit(c, auditEvent);
  } else {
    await writeAuditEvent(auditEvent);
  }

  return transmittedDocument;
}
