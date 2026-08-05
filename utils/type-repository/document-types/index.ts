import type { AnyDocumentType } from "./types";
import { invoiceDocumentType } from "./invoice";
import { creditNoteDocumentType } from "./creditNote";
import { selfBillingInvoiceDocumentType } from "./selfBillingInvoice";
import { selfBillingCreditNoteDocumentType } from "./selfBillingCreditNote";
import { messageLevelResponseDocumentType } from "./messageLevelResponse";
import { frenchInvoicingCdarDocumentType } from "./frenchInvoicingCdar";
import { frenchB2CSalesReportDocumentType } from "./frenchB2CSalesReport";
import { frenchB2CPaymentReportDocumentType } from "./frenchB2CPaymentReport";

/** Every document type the platform knows, in no significant order. */
export const documentTypes: readonly AnyDocumentType[] = [
  invoiceDocumentType,
  creditNoteDocumentType,
  selfBillingInvoiceDocumentType,
  selfBillingCreditNoteDocumentType,
  messageLevelResponseDocumentType,
  frenchInvoicingCdarDocumentType,
  frenchB2CSalesReportDocumentType,
  frenchB2CPaymentReportDocumentType,
];

export function getDocumentType(key: string): AnyDocumentType | undefined {
  return documentTypes.find((documentType) => documentType.key === key);
}
