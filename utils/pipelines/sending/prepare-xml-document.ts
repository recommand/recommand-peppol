import { normalizeProcessId } from "@peppol/utils/parsing/process-id";
import {
  detectDocumentFormat,
  getDocumentFormatByDocTypeId,
  resolveFormatProcessId,
} from "@peppol/utils/type-repository/document-formats";
import { SendingFailure } from "./errors";
import type { PreparedDocument, SendingInput } from "./types";

export function prepareXmlDocument(input: SendingInput): PreparedDocument {
  const xml = input.document as string;
  const detectedFormat = detectDocumentFormat(xml);
  const format = input.doctypeId
    ? getDocumentFormatByDocTypeId(input.doctypeId) ?? detectedFormat
    : detectedFormat;
  if (!input.doctypeId && !format) {
    throw new SendingFailure(
      "Document type could not be detected automatically from your XML document. Please provide the doctypeId manually.",
      400,
    );
  }

  let type = "unknown";
  let parsed: any = null;
  if (format) {
    try {
      const documentType = format.detectDocumentType(xml);
      parsed = documentType.documentSchema.parse(
        format.decode(xml, input.processId ?? ""),
      );
      type = documentType.key;
    } catch (error) {
      console.error("Failed to parse outgoing XML document:", error);
    }
  }

  let processId = input.processId;
  if (!processId && format) {
    processId = parsed
      ? resolveFormatProcessId(format, parsed)
      : format.supportedProcessIds[0];
  }
  if (!processId) {
    throw new SendingFailure(
      "Failed to detect process id. Please provide the processId manually.",
      400,
    );
  }

  return {
    type,
    parsed,
    xml,
    docTypeId: input.doctypeId ?? format!.docTypeId,
    processId: normalizeProcessId(processId),
    body: xml,
    contentType: "application/xml",
    originalPayload: null,
  };
}
