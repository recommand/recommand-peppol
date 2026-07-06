import { db } from "@recommand/db";
import { transferEvents, transmittedDocuments } from "@peppol/db/schema";
import {
  parsedHasAttachments,
  uploadDocumentOriginalPayload,
  type OriginalPayloadContainerFormat,
} from "@peppol/data/offload/storage";
import { getCompanyByPeppolId } from "@peppol/data/companies";
import { UserFacingError } from "@peppol/utils/util";
import { parseDocument } from "@peppol/utils/parsing/parse-document";
import { DOCUMENT_SCHEME, PROCESS_SCHEME } from "./phoss-smp/service-metadata";
import { sendIncomingDocumentNotifications } from "./send-document-notifications";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { findSupplierByVatAndPeppolId } from "./suppliers";
import { assignSupplierLabelsToDocument } from "./document-labels";
import { validateXmlDocument } from "./validation/client";
import type { ValidationResponse } from "@peppol/types/validation";
import type { Invoice } from "@peppol/utils/parsing/invoice/schemas";
import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import { getTransmittedDocumentSearchFields } from "@peppol/utils/transmitted-document-search";
import { ulid } from "ulid";
import { publishEvent } from "@core/data/rules/events";
import { extractFacturXDocument } from "./factur-x/client";
import {
  CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  FACTURX_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
  FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
} from "@peppol/utils/document-types";

type IncomingPayload = {
  xmlDocument: string;
  parseDocTypeId: string;
  originalPayload: {
    content: Buffer;
    containerFormat: Exclude<OriginalPayloadContainerFormat, "none">;
  } | null;
};

function isFacturXDocTypeId(docTypeId: string): boolean {
  return docTypeId === FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId
    || docTypeId === FACTURX_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO.docTypeId;
}

function isPdfContentType(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().split(";")[0].trim() === "application/pdf";
}

function isXmlContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return true;
  }
  const mimeType = contentType.toLowerCase().split(";")[0].trim();
  return mimeType === "application/xml";
}

async function resolveIncomingPayload(options: {
  cleanDocTypeId: string;
  body: BodyInit;
  contentType?: string;
}): Promise<IncomingPayload> {
  const isBinaryPayload = !isXmlContentType(options.contentType);

  if (isFacturXDocTypeId(options.cleanDocTypeId)) {
    if (!isBinaryPayload) {
      throw new UserFacingError("Factur-X documents must be received as a binary PDF payload.");
    }
    if (!isPdfContentType(options.contentType)) {
      throw new UserFacingError("Factur-X documents must be received as application/pdf.");
    }
    const pdf = Buffer.from(await new Response(options.body).arrayBuffer());
    const { xmlDocument } = await extractFacturXDocument({
      pdf: {
        content: pdf,
        mimeCode: "application/pdf",
      },
    });
    return {
      xmlDocument,
      parseDocTypeId: CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
      originalPayload: {
        content: pdf,
        containerFormat: "pdf",
      },
    };
  }

  if (isBinaryPayload) {
    throw new UserFacingError("Binary payloads are only supported for Factur-X document types.");
  }

  return {
    xmlDocument: await new Response(options.body).text(),
    parseDocTypeId: options.cleanDocTypeId,
    originalPayload: null,
  };
}

export async function receiveDocument(options: {
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
  countryC1: string;
  body: BodyInit;
  contentType?: string;
  skipBilling?: boolean;
  useTestNetwork?: boolean;
  playgroundTeamId?: string;
  as4MessageId?: string | null;
  as4ConversationId?: string | null;
  sbdhInstanceIdentifier?: string | null;
}) {
  // The sender and receiver id might start with iso6523-actorid-upis::
  const senderId = options.senderId.startsWith("iso6523-actorid-upis::")
    ? options.senderId.split("::")[1]
    : options.senderId;
  const receiverId = options.receiverId.startsWith("iso6523-actorid-upis::")
    ? options.receiverId.split("::")[1]
    : options.receiverId;

  // Get the teamId and companyId from the receiverId
  const company = await getCompanyByPeppolId({
    peppolId: receiverId,
    playgroundTeamId: options.playgroundTeamId,
    useTestNetwork: options.useTestNetwork,
  });
  if (!company) {
    throw new UserFacingError("Company not found");
  }

  // Remove document type identifier scheme from the docTypeId if present
  let cleanDocTypeId = options.docTypeId;
  const documentSchemePrefix = DOCUMENT_SCHEME + "::";
  if(options.docTypeId.startsWith(documentSchemePrefix)) {
    cleanDocTypeId = options.docTypeId.substring(documentSchemePrefix.length);
  }

  // Remove process identifier scheme from the processId if present
  let cleanProcessId = options.processId;
  const processSchemePrefix = PROCESS_SCHEME + "::";
  if(options.processId.startsWith(processSchemePrefix)) {
    cleanProcessId = options.processId.substring(processSchemePrefix.length);
  }

  const payload = await resolveIncomingPayload({
    cleanDocTypeId,
    body: options.body,
    contentType: options.contentType,
  });

  const validation: ValidationResponse = await validateXmlDocument(payload.xmlDocument);

  const parseResults = parseDocument(payload.parseDocTypeId, payload.xmlDocument, company, senderId);
  const type = parseResults.type;
  const parsedDocument = parseResults.parsedDocument;
  const transmittedDocumentId = "doc_" + ulid();
  const transmittedDocumentCreatedAt = new Date();
  const transmittedDocumentSearchFields = getTransmittedDocumentSearchFields({
    id: transmittedDocumentId,
    senderId,
    receiverId,
    docTypeId: cleanDocTypeId,
    processId: cleanProcessId,
    countryC1: options.countryC1,
    type,
    parsedDocument,
  });
  let s3KeyPrefix: string | null = null;
  let originalPayloadLocation: "none" | "s3" = "none";
  let originalPayloadContainerFormat: OriginalPayloadContainerFormat = "none";

  if (payload.originalPayload) {
    try {
      s3KeyPrefix = await uploadDocumentOriginalPayload(
        {
          id: transmittedDocumentId,
          teamId: company.teamId,
          companyId: company.id,
          createdAt: transmittedDocumentCreatedAt,
        },
        payload.originalPayload.content,
        payload.originalPayload.containerFormat
      );
      originalPayloadLocation = "s3";
      originalPayloadContainerFormat = payload.originalPayload.containerFormat;
    } catch (error) {
      console.error("Failed to upload original incoming payload:", error);
      sendSystemAlert(
        "Original Payload Upload Failed",
        `Failed to upload original incoming payload. Error: \`\`\`\n${error}\n\`\`\``,
        "error"
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
      senderId: senderId,
      receiverId: receiverId,
      docTypeId: cleanDocTypeId,
      processId: cleanProcessId,
      countryC1: options.countryC1,
      accessPointProvider: company.accessPointProvider,
      smpProvider: company.smpProvider,
      xml: payload.xmlDocument,
      xmlLocation: "db",
      attachmentsLocation: parsedHasAttachments(parsedDocument) ? "db" : "none",
      originalPayloadLocation,
      originalPayloadContainerFormat,
      s3KeyPrefix,
      peppolMessageId: options.as4MessageId ?? null,
      peppolConversationId: options.as4ConversationId ?? null,
      envelopeId: options.sbdhInstanceIdentifier ?? null,
      type,
      parsed: parsedDocument,
      validation,
      ...transmittedDocumentSearchFields,
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

  // Create a new transferEvent for billing
  if (!options.skipBilling) {
    await db.insert(transferEvents).values({
      teamId: company.teamId,
      companyId: company.id,
      direction: "incoming",
      transmittedDocumentId: transmittedDocument.id,
    });
  }

  // Try to match supplier and assign labels
  if (parsedDocument && (type === "invoice" || type === "creditNote")) {
    try {
      const vatNumber = (parsedDocument as Invoice | CreditNote).seller?.vatNumber || null;
      const supplier = await findSupplierByVatAndPeppolId(
        company.teamId,
        vatNumber,
        senderId
      );

      if (supplier) {
        await assignSupplierLabelsToDocument(
          company.teamId,
          transmittedDocument.id,
          supplier.id
        );
      }
    } catch (error) {
      console.error("Failed to match supplier or assign labels:", error);
    }
  }

  // Send notification emails to configured addresses
  try {
    await sendIncomingDocumentNotifications({
      transmittedDocumentId: transmittedDocument.id,
      companyId: company.id,
      companyName: company.name,
      type,
      parsedDocument,
      xmlDocument: payload.xmlDocument,
      isPlayground: (options.useTestNetwork || options.playgroundTeamId) ? true : false,
    });
  } catch (error) {
    console.error("Failed to send incoming document notifications:", error);
    sendSystemAlert(
      "Document Notification Sending Failed",
      `Failed to send incoming document notification for document ${transmittedDocument.id}.`,
      "error"
    );
  }
}
