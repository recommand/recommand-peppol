import type { ParsedDocument } from "@peppol/utils/document-filename";
import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import type { Invoice } from "@peppol/utils/parsing/invoice/schemas";
import type { SelfBillingCreditNote } from "@peppol/utils/parsing/self-billing-creditnote/schemas";
import type { SelfBillingInvoice } from "@peppol/utils/parsing/self-billing-invoice/schemas";
import type { FrenchB2CReport } from "@peppol/utils/parsing/b2c-reporting/france";
import {
  FRENCH_TAX_ADMINISTRATION_NAME,
  isReportingDocumentType,
  type DocumentType,
} from "@peppol/utils/document-types";

/** Stand-in shown when a document names no counterparty. */
export const UNNAMED_PARTY = "Unknown";

export type DocumentDetails = {
  documentNumber?: string;
  amount?: string;
  currency?: string;
  senderName?: string;
  receiverName?: string;
};

/**
 * Extracts what a notification email shows about a document. Party names are only
 * returned when the document actually names that party; callers decide how to
 * present a missing one.
 */
export function extractDocumentDetails(
  parsedDocument: ParsedDocument | null,
  type: DocumentType
): DocumentDetails {
  if (!parsedDocument) {
    return {};
  }

  let documentNumber: string | undefined;
  let amount: string | undefined;
  let currency: string | undefined;

  // Reports are filed with a tax administration, so they have no sender or buyer to
  // name, and they carry daily totals instead of a document total.
  if (isReportingDocumentType(type)) {
    const report = parsedDocument as FrenchB2CReport;
    return {
      documentNumber: report.reference,
      amount: report.type === "sales" ? report.taxExclusiveAmount : undefined,
      currency: report.type === "sales" ? report.currency : undefined,
      receiverName: FRENCH_TAX_ADMINISTRATION_NAME,
    };
  }

  if ("invoiceNumber" in parsedDocument) {
    documentNumber = parsedDocument.invoiceNumber;
  } else if ("creditNoteNumber" in parsedDocument) {
    documentNumber = parsedDocument.creditNoteNumber;
  }

  if (
    "totals" in parsedDocument &&
    parsedDocument.totals &&
    typeof parsedDocument.totals === "object"
  ) {
    const totals = parsedDocument.totals as { payableAmount?: number | string };
    amount = totals.payableAmount?.toString();
    currency = "-";
  }

  let senderName: string | undefined;
  let receiverName: string | undefined;
  if (["invoice", "creditNote"].includes(type)) {
    const document = parsedDocument as Invoice | CreditNote;
    senderName = document.seller?.name || undefined;
    receiverName = document.buyer?.name || undefined;
  } else if (["selfBillingInvoice", "selfBillingCreditNote"].includes(type)) {
    // Self-billing reverses the roles: the buyer issues and sends the document.
    const document = parsedDocument as SelfBillingInvoice | SelfBillingCreditNote;
    senderName = document.buyer?.name || undefined;
    receiverName = document.seller?.name || undefined;
  }

  return {
    documentNumber,
    amount,
    currency,
    senderName,
    receiverName,
  };
}
