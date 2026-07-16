import { UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO } from "@peppol/utils/document-types";
import { frenchRegulatedBillingDocumentToUBL } from "../../ubl-france-regulated/to-xml";
import { prebuildInvoiceUBL } from "../peppol-ubl-bis3/to-xml";
import type { Invoice } from "../schemas";

export function frenchRegulatedInvoiceToUBL({
  invoice,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
}: {
  invoice: Invoice;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
}): string {
  return frenchRegulatedBillingDocumentToUBL({
    document: invoice,
    documentTypeInfo: UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO,
    rootName: "Invoice",
    ublDocument: prebuildInvoiceUBL({
      invoice,
      supplierAddress: senderAddress,
      customerAddress: recipientAddress,
      isDocumentValidationEnforced,
    }),
  });
}
