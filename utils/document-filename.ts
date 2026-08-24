import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import type { FranceCdar } from "@peppol/utils/parsing/france-cdar/schemas";
import type { Invoice } from "@peppol/utils/parsing/invoice/schemas";
import type { MessageLevelResponse } from "@peppol/utils/parsing/message-level-response/schemas";
import type { SelfBillingCreditNote } from "@peppol/utils/parsing/self-billing-creditnote/schemas";
import type { SelfBillingInvoice } from "@peppol/utils/parsing/self-billing-invoice/schemas";
import type { FrenchB2BiReport } from "@peppol/utils/parsing/b2bi-reporting/france";
import type { FrenchB2CReport } from "@peppol/utils/parsing/b2c-reporting/france";
import {
  isReportingDocumentTypeKey,
  type ReportingDocumentTypeKey,
  type StoredDocumentType,
} from "@peppol/utils/type-repository/document-types/keys";

export type ParsedDocument =
  | Invoice
  | CreditNote
  | SelfBillingInvoice
  | SelfBillingCreditNote
  | MessageLevelResponse
  | FranceCdar
  | FrenchB2CReport
  | FrenchB2BiReport;

const REPORT_FILENAME_PREFIXES: Record<ReportingDocumentTypeKey, string> = {
  frenchB2CSalesReport: "french-b2c-sales-report",
  frenchB2CPaymentReport: "french-b2c-payment-report",
  frenchB2BiInvoiceReport: "french-cross-border-invoice-report",
  frenchB2BiPaymentReport: "french-cross-border-payment-report",
};

export function getDocumentFilename(
  type: StoredDocumentType,
  parsedDocument: ParsedDocument | null
): string {
  if (!parsedDocument) {
    return "document";
  }

  // Reports are matched on their type first: a report names the document it
  // reports on, so it carries fields a billing document is recognised by.
  if (isReportingDocumentTypeKey(type) && "reference" in parsedDocument) {
    return `${REPORT_FILENAME_PREFIXES[type]}-${parsedDocument.reference}`;
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
