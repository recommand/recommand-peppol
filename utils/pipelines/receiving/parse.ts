import type { AnyDocumentFormat } from "@peppol/utils/type-repository/document-formats/types";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";

/**
 * The XML was recognised as a document type of its format, but did not decode. The
 * type is kept so a caller can still say what the document probably was.
 */
export class IncomingXmlDecodeError extends Error {
  constructor(
    readonly documentType: AnyDocumentType,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : "The document could not be decoded");
    this.name = "IncomingXmlDecodeError";
  }
}

/**
 * Parse incoming XML in a known format into its document type and parsed document.
 * Throws when the format does not recognise a document type in it, or when the
 * document does not decode; the caller decides what a failure means.
 */
export function parseIncomingXml(
  format: AnyDocumentFormat,
  xml: string,
  processId: string,
): { documentType: AnyDocumentType; parsedDocument: unknown } {
  const documentType = format.detectDocumentType(xml);
  try {
    return { documentType, parsedDocument: format.decode(xml, processId) };
  } catch (error) {
    throw new IncomingXmlDecodeError(documentType, error);
  }
}
