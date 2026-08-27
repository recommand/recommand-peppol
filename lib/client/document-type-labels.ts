import { fallbackT, type TranslationFunction } from "@core/lib/translations";
import type { StoredDocumentType } from "@peppol/utils/type-repository/document-types/keys";

/**
 * The name of every document type, and the only place each one is written.
 *
 * The enum values (creditNote, frenchInvoicingCdar, …) are not translation
 * keys, so translating them directly is a no-op. Everything that names a
 * document type goes through here: the tables and filters in the UI, the rule
 * editor's dropdowns, and the registry entries themselves, whose
 * `translatableTitle` is `getDocumentTypeTitle(key)`.
 *
 * The labels are written as `t("…")` calls rather than looked up from a plain
 * record so that scripts/analyze-translations.ts still sees them as terms.
 * This module stays free of registry imports so client bundles can use it.
 */
export function getDocumentTypeLabel(
  t: TranslationFunction,
  type: string,
): string {
  const labels: Record<StoredDocumentType, string> = {
    invoice: t("Invoice"),
    creditNote: t("Credit Note"),
    selfBillingInvoice: t("Self Billing Invoice"),
    selfBillingCreditNote: t("Self Billing Credit Note"),
    messageLevelResponse: t("Message Level Response"),
    frenchInvoicingCdar: t("French Invoicing CDAR"),
    frenchB2CSalesReport: t("French B2C Sales Report"),
    frenchB2CPaymentReport: t("French B2C Payment Report"),
    frenchB2BiInvoiceReport: t("French Cross-Border Invoice Report"),
    frenchB2BiPaymentReport: t("French Cross-Border Payment Report"),
    unknown: t("Unknown"),
  };
  return labels[type as StoredDocumentType] ?? type;
}

/** The untranslated English name of a document type, for server-side use. */
export function getDocumentTypeTitle(type: StoredDocumentType): string {
  return getDocumentTypeLabel(fallbackT, type);
}
