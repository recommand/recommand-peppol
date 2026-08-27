import { getCiiTypeCode } from "@peppol/utils/parsing/cii-d22b/type-code";
import { invoiceDocumentType } from "../document-types/invoice";
import { creditNoteDocumentType } from "../document-types/creditNote";

/**
 * Every CII format writes an invoice and a credit note under one document type
 * identifier and tells them apart by `ram:TypeCode`: 381 is a credit note, 380 an
 * invoice. A code that is neither reads as an invoice, which is where the legacy
 * dispatch lands too — `getCiiDocumentType` answers "unknown" and `parseDocument`
 * falls back to the first handler registered for the identifier, the invoice one.
 *
 * Shared rather than repeated per format: the rule belongs to the syntax, so the four
 * CII entries must not be able to drift apart on it.
 */
export function ciiDocumentType(
  xml: string
): typeof invoiceDocumentType | typeof creditNoteDocumentType {
  return getCiiTypeCode(xml) === "381"
    ? creditNoteDocumentType
    : invoiceDocumentType;
}
