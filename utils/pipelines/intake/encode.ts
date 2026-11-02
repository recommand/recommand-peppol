import { getDefaultCompanyIdentifier } from "@peppol/data/company-identifiers";
import { partyElectronicAddress } from "@peppol/utils/identifiers/electronic-address";
import type { PreparedIncomingDocument } from "@peppol/utils/pipelines/receiving/types";
import {
  getDocumentFormat,
  getDocumentFormatsByDocumentTypeKey,
  resolveFormatProcessId,
} from "@peppol/utils/type-repository/document-formats";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { MEDIA_TYPES, xmlText } from "./file-kind";
import type { ResultContext } from "./types";

type Party = { name?: string | null; country?: string | null; vatNumber?: string | null };

/** The document of a result as it is recorded: its XML and the Peppol envelope values. */
export type EncodedResult = {
  xml: string;
  docTypeId: string;
  processId: string;
  document: unknown;
  originalPayload: PreparedIncomingDocument["originalPayload"];
  sender: Party | null;
  senderId: string;
  receiverId: string | null;
};

/**
 * The party that sent the document: the party the document type names as its sender.
 * Read from the document itself, so it holds for self-billing, where the buyer sends.
 */
function sendingParty(documentType: AnyDocumentType, document: unknown): Party | null {
  const senderName = documentType.extractCounterparties(document).senderName;
  if (!senderName || !document || typeof document !== "object") {
    return null;
  }
  const parties = Object.values(document).filter(
    (value): value is Party => !!value && typeof value === "object" && "name" in value,
  );
  return parties.find((party) => party.name?.trim() === senderName.trim()) ?? null;
}

async function companyAddress(companyId: string): Promise<string | null> {
  try {
    const identifier = await getDefaultCompanyIdentifier(companyId);
    return `${identifier.scheme}:${identifier.identifier}`;
  } catch {
    return null;
  }
}

/**
 * The XML to record: the received XML, or the extracted content encoded in the type's
 * preferred format. The same input always gives the same XML, so the check stage can
 * validate the XML that the publish stage records.
 */
export async function encodeResult(
  context: ResultContext,
  documentType: AnyDocumentType,
  document: unknown,
): Promise<EncodedResult | { error: string }> {
  const sender = sendingParty(documentType, document);
  const senderId = partyElectronicAddress(sender) ?? "0000:0000";
  // The Peppol column keeps only a registered identifier of the company. The encoded
  // document names the company by its own numbers when it has no identifier.
  const receiverId = await companyAddress(context.company.id);
  const envelope = { sender, senderId, receiverId };

  const structured = context.checkpoints.structured;
  const pdf =
    context.primaryFile.mediaType === MEDIA_TYPES.pdf ? await context.readFile(context.primaryFile.id) : null;
  if (structured?.method === "parsed") {
    // The XML stays as received. A hybrid PDF is kept as the container it came in.
    const format = getDocumentFormat(structured.formatKey)!;
    return {
      ...envelope,
      xml: xmlText(await context.readFile(structured.xmlFileId)),
      docTypeId: format.docTypeId,
      processId: structured.processId,
      document,
      originalPayload: pdf ? { content: pdf, containerFormat: "pdf" } : null,
    };
  }

  // The PDF travels with the content, as an embedded attachment, like a PDF in a
  // Peppol document.
  const withPdf =
    pdf && documentType.pdfGeneration
      ? documentType.pdfGeneration.attachGeneratedPdf(document, {
          id: context.primaryFile.filename,
          filename: context.primaryFile.filename,
          mimeCode: MEDIA_TYPES.pdf,
          description: "The PDF the document was extracted from",
          embeddedDocument: pdf.toString("base64"),
          url: null,
        })
      : document;
  const format = getDocumentFormatsByDocumentTypeKey(documentType.key)[0];
  const processId = resolveFormatProcessId(format, withPdf);
  const recipientAddress = receiverId ?? partyElectronicAddress(context.company) ?? "0000:0000";
  try {
    const xml = format.encode(withPdf, processId, {
      senderAddress: senderId,
      recipientAddress,
      isDocumentValidationEnforced: false,
    });
    return { ...envelope, xml, docTypeId: format.docTypeId, processId, document: withPdf, originalPayload: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
