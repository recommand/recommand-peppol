export const BILLING_DOCUMENT_TYPE_KEYS = [
  "invoice",
  "creditNote",
  "selfBillingInvoice",
  "selfBillingCreditNote",
] as const;

export const TRANSACTION_MESSAGING_DOCUMENT_TYPE_KEYS = [
  "messageLevelResponse",
  "frenchInvoicingCdar",
] as const;

export const REPORTING_DOCUMENT_TYPE_KEYS = [
  "frenchB2CSalesReport",
  "frenchB2CPaymentReport",
] as const;

export type BillingDocumentTypeKey =
  (typeof BILLING_DOCUMENT_TYPE_KEYS)[number];
export type TransactionMessagingDocumentTypeKey =
  (typeof TRANSACTION_MESSAGING_DOCUMENT_TYPE_KEYS)[number];
export type ReportingDocumentTypeKey =
  (typeof REPORTING_DOCUMENT_TYPE_KEYS)[number];
export type DocumentTypeKey =
  | BillingDocumentTypeKey
  | TransactionMessagingDocumentTypeKey
  | ReportingDocumentTypeKey;
export type StoredDocumentType =
  | DocumentTypeKey
  | "invoiceResponse"
  | "unknown";
export type ParsedOrUnknownDocumentType = DocumentTypeKey | "unknown";

export function isBillingDocumentTypeKey(
  key: string,
): key is BillingDocumentTypeKey {
  return (BILLING_DOCUMENT_TYPE_KEYS as readonly string[]).includes(key);
}

export function isReportingDocumentTypeKey(
  key: string,
): key is ReportingDocumentTypeKey {
  return (REPORTING_DOCUMENT_TYPE_KEYS as readonly string[]).includes(key);
}
