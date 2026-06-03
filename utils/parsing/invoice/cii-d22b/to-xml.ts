import type { Invoice } from "../schemas";
import { CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO } from "@peppol/utils/document-types";
import { billingDocumentToCII } from "../../cii-d22b/to-xml";

export function invoiceToCII({
  invoice,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
  guidelineId,
}: {
  invoice: Invoice;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
  guidelineId?: string;
}): string {
  return billingDocumentToCII({
    document: invoice,
    documentTypeInfo: CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
    documentNumber: invoice.invoiceNumber,
    typeCode: "380",
    supplierAddress: senderAddress,
    customerAddress: recipientAddress,
    isDocumentValidationEnforced,
    dueDate: invoice.dueDate,
    guidelineId,
  });
}
