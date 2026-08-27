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
  "frenchB2BiInvoiceReport",
  "frenchB2BiPaymentReport",
] as const;

/**
 * Every type a stored document row can carry, and the single list the database
 * enum, the API response schemas and the rule engine's document type field are
 * all built from. A document type is added here once; nothing else re-declares
 * the set.
 *
 * Order is significant: it is the order the Postgres enum declares its values
 * in, so a new type is appended to its class rather than inserted before an
 * existing one. `unknown` stays last, which is what the migrations expect.
 */
export const STORED_DOCUMENT_TYPE_KEYS = [
  ...BILLING_DOCUMENT_TYPE_KEYS,
  ...TRANSACTION_MESSAGING_DOCUMENT_TYPE_KEYS,
  ...REPORTING_DOCUMENT_TYPE_KEYS,
  "unknown",
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
export type StoredDocumentType = (typeof STORED_DOCUMENT_TYPE_KEYS)[number];
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
