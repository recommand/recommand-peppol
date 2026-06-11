import { db } from "@recommand/db";
import { transferEvents, transmittedDocuments } from "@peppol/db/schema";
import { parsedHasAttachments } from "@peppol/data/offload/storage";
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

export async function receiveDocument(options: {
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
  countryC1: string;
  body: string;
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

  // Validate the XML document
  const validation: ValidationResponse = await validateXmlDocument(options.body);

  // Parse the XML document
  const parseResults = parseDocument(cleanDocTypeId, options.body, company, senderId);
  const type = parseResults.type;
  const parsedDocument = parseResults.parsedDocument;
  const transmittedDocumentId = "doc_" + ulid();
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

  // Create a new transmittedDocument
  const transmittedDocument = await db
    .insert(transmittedDocuments)
    .values({
      id: transmittedDocumentId,
      teamId: company.teamId,
      companyId: company.id,
      direction: "incoming",
      senderId: senderId,
      receiverId: receiverId,
      docTypeId: cleanDocTypeId,
      processId: cleanProcessId,
      countryC1: options.countryC1,
      xml: options.body,
      xmlLocation: options.body != null ? "db" : "none",
      attachmentsLocation: parsedHasAttachments(parsedDocument) ? "db" : "none",
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
      xmlDocument: options.body,
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
