import type { AnyDocumentType } from "./types";
import { invoiceDocumentType } from "./invoice";
import { creditNoteDocumentType } from "./creditNote";
import { selfBillingInvoiceDocumentType } from "./selfBillingInvoice";
import { selfBillingCreditNoteDocumentType } from "./selfBillingCreditNote";
import { messageLevelResponseDocumentType } from "./messageLevelResponse";
import { frenchInvoicingCdarDocumentType } from "./frenchInvoicingCdar";
import { frenchB2CSalesReportDocumentType } from "./frenchB2CSalesReport";
import { frenchB2CPaymentReportDocumentType } from "./frenchB2CPaymentReport";
import { frenchB2BiInvoiceReportDocumentType } from "./frenchB2BiInvoiceReport";
import { frenchB2BiPaymentReportDocumentType } from "./frenchB2BiPaymentReport";

/**
 * Every document type the platform knows, in no significant order.
 *
 * Declared as a tuple rather than `readonly AnyDocumentType[]` so the entries
 * keep their concrete schema types: `ParsedDocument` in ./parsed is derived
 * from this list, and a widened element type would collapse it to `any`.
 */
export const documentTypes = [
  invoiceDocumentType,
  creditNoteDocumentType,
  selfBillingInvoiceDocumentType,
  selfBillingCreditNoteDocumentType,
  messageLevelResponseDocumentType,
  frenchInvoicingCdarDocumentType,
  frenchB2CSalesReportDocumentType,
  frenchB2CPaymentReportDocumentType,
  frenchB2BiInvoiceReportDocumentType,
  frenchB2BiPaymentReportDocumentType,
] as const satisfies readonly AnyDocumentType[];

export function getDocumentType(key: string): AnyDocumentType | undefined {
  return (documentTypes as readonly AnyDocumentType[]).find(
    (documentType) => documentType.key === key,
  );
}
