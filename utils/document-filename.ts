import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import type { FranceCdar } from "@peppol/utils/parsing/france-cdar/schemas";
import type { Invoice } from "@peppol/utils/parsing/invoice/schemas";
import type { MessageLevelResponse } from "@peppol/utils/parsing/message-level-response/schemas";
import type { SelfBillingCreditNote } from "@peppol/utils/parsing/self-billing-creditnote/schemas";
import type { SelfBillingInvoice } from "@peppol/utils/parsing/self-billing-invoice/schemas";
import type { FrenchB2cReport } from "@peppol/utils/parsing/b2c-reporting/france";
import {
  isReportingDocumentType,
  type DocumentType,
} from "@peppol/utils/document-types";

export type ParsedDocument =
  | Invoice
  | CreditNote
  | SelfBillingInvoice
  | SelfBillingCreditNote
  | MessageLevelResponse
  | FranceCdar
  | FrenchB2cReport;

export function getDocumentFilename(
  type: DocumentType,
  parsedDocument: ParsedDocument | null
): string {
  if (!parsedDocument) {
    return "document";
  }

  if ("invoiceNumber" in parsedDocument) {
    return type === "selfBillingInvoice"
      ? `self-billing-invoice-${parsedDocument.invoiceNumber}`
      : `invoice-${parsedDocument.invoiceNumber}`;
  }

  if ("creditNoteNumber" in parsedDocument) {
    return type === "selfBillingCreditNote"
      ? `self-billing-credit-note-${parsedDocument.creditNoteNumber}`
      : `credit-note-${parsedDocument.creditNoteNumber}`;
  }

  if (type === "frenchInvoicingCdar" && "invoiceId" in parsedDocument) {
    return `french-invoicing-cdar-${parsedDocument.invoiceId}`;
  }

  if (isReportingDocumentType(type) && "reference" in parsedDocument) {
    return type === "frenchB2cPaymentReport"
      ? `french-b2c-payment-report-${parsedDocument.reference}`
      : `french-b2c-sales-report-${parsedDocument.reference}`;
  }

  return "document";
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
