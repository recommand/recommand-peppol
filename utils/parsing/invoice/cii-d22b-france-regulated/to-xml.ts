import {
  CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  type DocumentTypeInfo,
} from "@peppol/utils/document-types";
import { frenchRegulatedBillingDocumentToCII } from "../../cii-d22b/france-regulated/to-xml";
import type { Invoice } from "../schemas";

export function frenchRegulatedInvoiceToCII({
  invoice,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
  documentTypeInfo = CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
}: {
  invoice: Invoice;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
  documentTypeInfo?: DocumentTypeInfo;
}): string {
  return frenchRegulatedBillingDocumentToCII({
    document: invoice,
    documentTypeInfo,
    documentNumber: invoice.invoiceNumber,
    typeCode: "380",
    supplierAddress: senderAddress,
    customerAddress: recipientAddress,
    isDocumentValidationEnforced,
    dueDate: invoice.dueDate,
  });
}
