import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import type { DocumentTypeKey } from "@peppol/utils/type-repository/document-types/types";
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

  try {
    const documentType = payload.format.detectDocumentType(payload.xmlDocument);
    result.documentType = documentType;
    result.probableType = documentType.key as DocumentTypeKey;
    result.parsedDocument = payload.format.decode(
      payload.xmlDocument,
      input.processId,
    );
    result.type = documentType.key as DocumentTypeKey;
  } catch (error) {
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
