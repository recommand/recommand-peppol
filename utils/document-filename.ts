import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import type { StoredDocumentType } from "@peppol/utils/type-repository/document-types/keys";
import type { ParsedDocument } from "@peppol/utils/type-repository/document-types/parsed";

export type { ParsedDocument };

/**
 * The base filename a document is offered under, taken from the document type
 * that produced it. Naming a document is the registry's job: deriving it from
 * the parsed document's shape instead would confuse a report with the document
 * it reports on, since both carry an invoice number.
 */
export function getDocumentFilename(
  type: StoredDocumentType,
  parsedDocument: ParsedDocument | null
): string {
  if (!parsedDocument) {
    return "document";
  }

  return getDocumentType(type)?.generateFilename(parsedDocument) ?? "document";
}

export function ensureFileExtension(
  filename: string,
  extension: string
): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return filename.toLowerCase().endsWith(ext.toLowerCase())
    ? filename
    : filename + ext;
}
