import type { TranslationFunction } from "@core/lib/translations";

/**
 * Human-readable, translatable label for a document type enum value.
 *
 * The enum values (creditNote, frenchInvoicingCdar, …) are not translation
 * keys, so translating them directly is a no-op. Every place that shows a
 * document type to a user should go through here so the table, the detail page
 * and the type filter stay in agreement.
 */
export function getDocumentTypeLabel(t: TranslationFunction, type: string): string {
  switch (type) {
    case "invoice":
      return t`Invoice`;
    case "creditNote":
      return t`Credit Note`;
    case "selfBillingInvoice":
      return t`Self Billing Invoice`;
    case "selfBillingCreditNote":
      return t`Self Billing Credit Note`;
    case "messageLevelResponse":
      return t`Message Level Response`;
    case "frenchInvoicingCdar":
      return t`French Invoicing CDAR`;
    case "frenchB2CSalesReport":
      return t`French B2C Sales Report`;
    case "frenchB2CPaymentReport":
      return t`French B2C Payment Report`;
    case "frenchB2BiInvoiceReport":
      return t`French Cross-Border Invoice Report`;
    case "frenchB2BiPaymentReport":
      return t`French Cross-Border Payment Report`;
    case "unknown":
      return t`Unknown`;
    default:
      return type;
  }
}
