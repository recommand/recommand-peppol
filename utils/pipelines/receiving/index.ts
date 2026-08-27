import { publishEvent } from "@core/data/rules/events";
import { getCompanyByPeppolId } from "@peppol/data/companies";
import { assignSupplierLabelsToDocument } from "@peppol/data/document-labels";
import {
  parsedHasAttachments,
  uploadDocumentOriginalPayload,
  type OriginalPayloadContainerFormat,
} from "@peppol/data/offload/storage";
import { DOCUMENT_SCHEME, PROCESS_SCHEME } from "@peppol/data/phoss-smp/service-metadata";
import { sendIncomingDocumentNotifications } from "@peppol/data/send-document-notifications";
import { findSupplierByVatAndPeppolId } from "@peppol/data/suppliers";
import { validateXmlDocument } from "@peppol/data/validation/client";
import { transferEvents, transmittedDocuments } from "@peppol/db/schema";
import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import type { Invoice } from "@peppol/utils/parsing/invoice/schemas";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { UserFacingError } from "@peppol/utils/util";
import { db } from "@recommand/db";
import { ulid } from "ulid";
import { prepareIncomingDocument } from "./prepare-document";
import type { ReceivingPipelineInput } from "./types";

export async function receivingPipeline(
  options: ReceivingPipelineInput,
) {
  const senderId = options.senderId.startsWith("iso6523-actorid-upis::")
    ? options.senderId.split("::")[1]
    : options.senderId;
  const receiverId = options.receiverId.startsWith("iso6523-actorid-upis::")
    ? options.receiverId.split("::")[1]
    : options.receiverId;

  const company = await getCompanyByPeppolId({
    peppolId: receiverId,
    playgroundTeamId: options.playgroundTeamId,
    useTestNetwork: options.useTestNetwork,
  });
  if (!company) {
    throw new UserFacingError("Company not found");
  }

  const documentSchemePrefix = `${DOCUMENT_SCHEME}::`;
  const docTypeId = options.docTypeId.startsWith(documentSchemePrefix)
    ? options.docTypeId.substring(documentSchemePrefix.length)
    : options.docTypeId;
  const processSchemePrefix = `${PROCESS_SCHEME}::`;
  const processId = options.processId.startsWith(processSchemePrefix)
    ? options.processId.substring(processSchemePrefix.length)
    : options.processId;

  const received = await prepareIncomingDocument({
    docTypeId,
    processId,
    body: options.body,
    contentType: options.contentType,
    company,
    senderId,
  });
  const validation = await validateXmlDocument(received.xmlDocument);
  const type = received.type;
  const parsedDocument = received.parsedDocument;
  const transmittedDocumentId = `doc_${ulid()}`;
  const transmittedDocumentCreatedAt = new Date();
  const counterparties = received.documentType && parsedDocument
    ? received.documentType.extractCounterparties(parsedDocument)
    : { senderName: null, receiverName: null };
  const documentNumber = received.documentType && parsedDocument
    ? received.documentType.extractDocumentNumber(parsedDocument)
    : null;
  const documentSearchableText = received.documentType && parsedDocument
    ? received.documentType.extractSearchableText(parsedDocument)
    : "";
  const searchText = [
    transmittedDocumentId,
    senderId,
    receiverId,
    docTypeId,
    processId,
    options.countryC1,
    documentSearchableText,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  let s3KeyPrefix: string | null = null;
  let originalPayloadLocation: "none" | "s3" = "none";
  let originalPayloadContainerFormat: OriginalPayloadContainerFormat = "none";

  if (received.originalPayload) {
    try {
      s3KeyPrefix = await uploadDocumentOriginalPayload(
        {
          id: transmittedDocumentId,
          teamId: company.teamId,
          companyId: company.id,
          createdAt: transmittedDocumentCreatedAt,
        },
        received.originalPayload.content,
        received.originalPayload.containerFormat,
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

  const transmittedDocument = await db
    .insert(transmittedDocuments)
    .values({
      id: transmittedDocumentId,
      teamId: company.teamId,
      companyId: company.id,
      createdAt: transmittedDocumentCreatedAt,
      direction: "incoming",
      senderId,
      receiverId,
      docTypeId,
      processId,
      countryC1: options.countryC1,
      accessPointProvider: company.accessPointProvider,
      smpProvider: company.smpProvider,
      xml: received.xmlDocument,
      xmlLocation: "db",
      attachmentsLocation: parsedHasAttachments(parsedDocument) ? "db" : "none",
      originalPayloadLocation,
      originalPayloadContainerFormat,
      s3KeyPrefix,
      peppolMessageId: options.as4MessageId ?? null,
      peppolConversationId: options.as4ConversationId ?? null,
      envelopeId: options.sbdhInstanceIdentifier ?? null,
      apTransactionId: options.apTransactionId ?? null,
      type,
      parsed: parsedDocument,
      validation,
      ...counterparties,
      documentNumber,
      searchText,
    })
    .returning({ id: transmittedDocuments.id })
    .then((rows) => rows[0]);

  await publishEvent("peppol.document.received.v1", {
    teamId: company.teamId,
    aggregateType: "peppol.document",
    aggregateId: transmittedDocument.id,
    idempotencyKey: `peppol.document.received:${transmittedDocument.id}`,
    payload: {
      companyId: company.id,
      docType: type,
      senderId,
      receiverId,
      peppolMessageId: options.as4MessageId ?? null,
      peppolConversationId: options.as4ConversationId ?? null,
      envelopeId: options.sbdhInstanceIdentifier ?? null,
      countryC1: options.countryC1,
    },
  });

  if (!options.skipBilling) {
    await db.insert(transferEvents).values({
      teamId: company.teamId,
      companyId: company.id,
      direction: "incoming",
      transmittedDocumentId: transmittedDocument.id,
    });
  }

  if (parsedDocument && (type === "invoice" || type === "creditNote")) {
    try {
      const vatNumber =
        (parsedDocument as Invoice | CreditNote).seller?.vatNumber || null;
      const supplier = await findSupplierByVatAndPeppolId(
        company.teamId,
        vatNumber,
        senderId,
      );

      if (supplier) {
        await assignSupplierLabelsToDocument(
          company.teamId,
          transmittedDocument.id,
          supplier.id,
        );
      }
    } catch (error) {
      console.error("Failed to match supplier or assign labels:", error);
    }
  }

  try {
    await sendIncomingDocumentNotifications({
      transmittedDocumentId: transmittedDocument.id,
      companyId: company.id,
      companyName: company.name,
      type,
      parsedDocument,
      xmlDocument: received.xmlDocument,
      isPlayground:
        options.useTestNetwork || options.playgroundTeamId ? true : false,
    });
  } catch (error) {
    console.error("Failed to send incoming document notifications:", error);
    sendSystemAlert(
      "Document Notification Sending Failed",
      `Failed to send incoming document notification for document ${transmittedDocument.id}.`,
      "error",
    );
  }
}

export type {
  IncomingOriginalPayload,
  PreparedIncomingDocument,
  ReceivingPipelineInput,
} from "./types";
