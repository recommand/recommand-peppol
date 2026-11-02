import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import type { DocumentTypeKey } from "@peppol/utils/type-repository/document-types/types";
import { IncomingXmlDecodeError, parseIncomingXml } from "./parse";
import { prepareIncomingPayload } from "./prepare-payload";
import type {
  IncomingDocumentInput,
  PreparedIncomingDocument,
} from "./types";

export async function prepareIncomingDocument(
  input: IncomingDocumentInput,
): Promise<PreparedIncomingDocument> {
  const payload = await prepareIncomingPayload(input);
  const result: PreparedIncomingDocument = {
    documentType: undefined,
    type: "unknown",
    probableType: "unknown",
    parsedDocument: null,
    xmlDocument: payload.xmlDocument,
    originalPayload: payload.originalPayload,
  };

  if (!payload.format) {
    return result;
  }

  // A message on the network has to be accepted whatever its content, so a document
  // that does not parse is kept as unknown, and reported.
  try {
    const parsed = parseIncomingXml(
      payload.format,
      payload.xmlDocument,
      input.processId,
    );
    result.documentType = parsed.documentType;
    result.probableType = parsed.documentType.key as DocumentTypeKey;
    result.parsedDocument = parsed.parsedDocument;
    result.type = parsed.documentType.key as DocumentTypeKey;
  } catch (error) {
    if (error instanceof IncomingXmlDecodeError) {
      result.documentType = error.documentType;
      result.probableType = error.documentType.key as DocumentTypeKey;
    }
    console.error(
      `Failed to parse ${payload.format.translatableTitle} XML:`,
      error,
    );
    sendSystemAlert(
      "Document Parsing Error",
      `Failed to parse ${payload.format.translatableTitle} XML\n\n` +
        `Company: ${input.company.name}\n` +
        `Sender: ${input.senderId}\n` +
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      "error",
    );
  }

  return result;
}
