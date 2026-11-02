import { publishEvent } from "@core/data/rules/events";
import type { Company } from "@peppol/data/companies";
import { assignSupplierLabelsToDocument } from "@peppol/data/document-labels";
import {
  parsedHasAttachments,
  S3_OPERATION_TIMEOUT_MS,
  uploadDocumentOriginalPayload,
  type OriginalPayloadContainerFormat,
} from "@peppol/data/offload/storage";
import { sendIncomingDocumentNotifications } from "@peppol/data/send-document-notifications";
import { findSupplierByVatAndPeppolId } from "@peppol/data/suppliers";
import { recordUsageEvents, usageEventId } from "@peppol/data/usage";
import { validateXmlDocument } from "@peppol/data/validation/client";
import { transmittedDocuments } from "@peppol/db/schema";
import type { Finding, ProcessingMethod } from "@peppol/types/intake";
import type { ValidationResponse } from "@peppol/types/validation";
import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import type { Invoice } from "@peppol/utils/parsing/invoice/schemas";
import type { PreparedIncomingDocument } from "@peppol/utils/pipelines/receiving/types";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { withTimeout } from "@peppol/utils/timeout";
import { getValidationProfile } from "@peppol/utils/type-repository/document-formats";
import { isBillableDocument } from "@peppol/utils/type-repository/document-types/billing";
import { db } from "@recommand/db";
import { ulid } from "ulid";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Where an incoming document came from. Only this differs between the receiving channels. */
export type IncomingDocumentSource =
  | {
      channel: "peppol";
      senderId: string;
      receiverId: string;
      docTypeId: string;
      processId: string;
      countryC1: string;
      as4MessageId?: string | null;
      as4ConversationId?: string | null;
      sbdhInstanceIdentifier?: string | null;
      apTransactionId?: string | null;
    }
  | {
      channel: "email" | "api";
      importId: string;
      processingMethod: ProcessingMethod;
      findings: Finding[];
      senderId: string;
      receiverId: string | null;
      docTypeId: string;
      processId: string;
      countryC1: string;
    };

export type RecordIncomingDocumentInput = {
  received: PreparedIncomingDocument;
  company: Company;
  source: IncomingDocumentSource;
  skipBilling?: boolean;
  /** Validation already run by the caller; validated here when absent. */
  validation?: ValidationResponse;
};

/** A document ready to insert: validated, with its original payload stored. */
export type IncomingDocumentRecord = {
  row: typeof transmittedDocuments.$inferInsert & { id: string };
  input: RecordIncomingDocumentInput;
};

/**
 * Everything about an incoming document that has to happen outside the database:
 * validation and storing a container payload. Kept apart so a caller can run it
 * before it opens the transaction the document is inserted in.
 */
export async function prepareIncomingDocumentRecord(
  input: RecordIncomingDocumentInput,
): Promise<IncomingDocumentRecord> {
  const { received, company, source } = input;
  const validation =
    input.validation ??
    (await validateXmlDocument(received.xmlDocument, {
      profile: getValidationProfile(source.docTypeId),
    }));
  const id = `doc_${ulid()}`;
  const createdAt = new Date();
  const parsedDocument = received.parsedDocument;
  const documentType = parsedDocument ? received.documentType : undefined;
  const counterparties = documentType
    ? documentType.extractCounterparties(parsedDocument)
    : { senderName: null, receiverName: null };
  const documentNumber = documentType ? documentType.extractDocumentNumber(parsedDocument) : null;
  const searchText = [
    id,
    source.senderId,
    source.receiverId,
    source.docTypeId,
    source.processId,
    source.countryC1,
    documentType ? documentType.extractSearchableText(parsedDocument) : "",
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  let s3KeyPrefix: string | null = null;
  let originalPayloadLocation: "none" | "s3" = "none";
  let originalPayloadContainerFormat: OriginalPayloadContainerFormat = "none";
  if (received.originalPayload) {
    try {
      s3KeyPrefix = await withTimeout(
        uploadDocumentOriginalPayload(
          { id, teamId: company.teamId, companyId: company.id, createdAt },
          received.originalPayload.content,
          received.originalPayload.containerFormat,
        ),
        S3_OPERATION_TIMEOUT_MS,
        `Original payload upload for ${id}`,
      );
      originalPayloadLocation = "s3";
      originalPayloadContainerFormat = received.originalPayload.containerFormat;
    } catch (error) {
      console.error("Failed to upload original incoming payload:", error);
      sendSystemAlert(
        "Original Payload Upload Failed",
        `Failed to upload original incoming payload. Error: \`\`\`\n${error}\n\`\`\``,
        "error",
      );
    }
  }

  const peppol = source.channel === "peppol" ? source : null;
  const intake = source.channel === "peppol" ? null : source;
  return {
    input,
    row: {
      id,
      teamId: company.teamId,
      companyId: company.id,
      createdAt,
      direction: "incoming",
      senderId: source.senderId,
      receiverId: source.receiverId,
      docTypeId: source.docTypeId,
      processId: source.processId,
      countryC1: source.countryC1,
      accessPointProvider: company.accessPointProvider,
      smpProvider: company.smpProvider,
      xml: received.xmlDocument,
      xmlLocation: "db",
      attachmentsLocation: parsedHasAttachments(parsedDocument) ? "db" : "none",
      originalPayloadLocation,
      originalPayloadContainerFormat,
      s3KeyPrefix,
      sentOverPeppol: !intake,
      peppolMessageId: peppol?.as4MessageId ?? null,
      peppolConversationId: peppol?.as4ConversationId ?? null,
      envelopeId: peppol?.sbdhInstanceIdentifier ?? null,
      apTransactionId: peppol?.apTransactionId ?? null,
      sourceChannel: intake?.channel ?? null,
      importId: intake?.importId ?? null,
      processingMethod: intake?.processingMethod ?? null,
      findings: intake ? intake.findings : null,
      type: received.type,
      parsed: parsedDocument,
      validation,
      ...counterparties,
      documentNumber,
      searchText,
    },
  };
}

/**
 * Insert a prepared incoming document with its received event and its usage, in the
 * caller's transaction, so the document and what the caller records with it commit
 * together.
 */
export async function insertIncomingDocumentRecord(
  record: IncomingDocumentRecord,
  tx: Transaction,
): Promise<string> {
  const { row, input } = record;
  const { company, source, received } = input;
  await tx.insert(transmittedDocuments).values(row);

  const intake = source.channel === "peppol" ? null : source;
  await publishEvent("peppol.document.received.v1", {
    teamId: company.teamId,
    streamId: company.id,
    aggregateType: "peppol.document",
    aggregateId: row.id,
    idempotencyKey: `peppol.document.received:${row.id}`,
    payload: {
      companyId: company.id,
      docType: received.type,
      senderId: source.senderId,
      receiverId: source.receiverId,
      peppolMessageId: row.peppolMessageId ?? null,
      peppolConversationId: row.peppolConversationId ?? null,
      envelopeId: row.envelopeId ?? null,
      countryC1: source.countryC1,
      ...(intake
        ? {
            channel: intake.channel,
            importId: intake.importId,
            processingMethod: intake.processingMethod,
          }
        : {}),
    },
    data: {
      direction: "incoming",
      parsed: received.parsedDocument ?? null,
      xml: received.xmlDocument ?? null,
    },
    tx,
  });

  // Transport receipts and platform-level lifecycle statuses are not charged; see
  // isBillableDocument for the rule. The detected type decides, so a lifecycle
  // status we could not read is not charged as an unknown business document.
  if (!input.skipBilling && isBillableDocument(received.probableType, received.parsedDocument)) {
    await recordUsageEvents(
      [
        {
          id: usageEventId({
            transmittedDocumentId: row.id,
            direction: "incoming",
            channel: source.channel,
          }),
          teamId: company.teamId,
          companyId: company.id,
          direction: "incoming",
          type: source.channel,
          // Only a document a model read is priced as AI processing; XML, embedded
          // in a PDF or not, is parsed without one.
          aiProcessed: intake?.processingMethod === "extracted",
          transmittedDocumentId: row.id,
        },
      ],
      tx,
    );
  }
  return row.id;
}

/** Validate, store and insert an incoming document, with its event and usage, in one transaction. */
export async function recordIncomingDocument(
  input: RecordIncomingDocumentInput,
): Promise<string> {
  const record = await prepareIncomingDocumentRecord(input);
  return await db.transaction((tx) => insertIncomingDocumentRecord(record, tx));
}

/**
 * What follows a recorded incoming document once it is committed: the labels of its
 * supplier and the notification emails. Their failures are reported, not thrown, so
 * they never undo the receipt.
 */
export async function runIncomingDocumentFollowUps(options: {
  documentId: string;
  received: PreparedIncomingDocument;
  company: Company;
  senderId: string;
  isPlayground: boolean;
}) {
  const { documentId, received, company } = options;
  const parsedDocument = received.parsedDocument;
  if (parsedDocument && (received.type === "invoice" || received.type === "creditNote")) {
    try {
      const vatNumber = (parsedDocument as Invoice | CreditNote).seller?.vatNumber || null;
      const supplier = await findSupplierByVatAndPeppolId(company.teamId, vatNumber, options.senderId);
      if (supplier) {
        await assignSupplierLabelsToDocument(company.teamId, documentId, supplier.id);
      }
    } catch (error) {
      console.error("Failed to match supplier or assign labels:", error);
    }
  }

  try {
    await sendIncomingDocumentNotifications({
      transmittedDocumentId: documentId,
      companyId: company.id,
      companyName: company.name,
      type: received.type,
      parsedDocument,
      xmlDocument: received.xmlDocument,
      isPlayground: options.isPlayground,
    });
  } catch (error) {
    console.error("Failed to send incoming document notifications:", error);
    sendSystemAlert(
      "Document Notification Sending Failed",
      `Failed to send incoming document notification for document ${documentId}.`,
      "error",
    );
  }
}
