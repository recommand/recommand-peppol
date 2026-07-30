import {
  UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO,
  type DocumentTypeInfo,
} from "@peppol/utils/document-types";
import { frenchRegulatedBillingDocumentToUBL } from "../../ubl-france-regulated/to-xml";
import { prebuildInvoiceUBL } from "../peppol-ubl-bis3/to-xml";
import type { Invoice } from "../schemas";

export function frenchRegulatedInvoiceToUBL({
  invoice,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
  documentTypeInfo = UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO,
}: {
  invoice: Invoice;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
  documentTypeInfo?: DocumentTypeInfo;
}): string {
  return frenchRegulatedBillingDocumentToUBL({
    document: invoice,
    documentTypeInfo,
    rootName: "Invoice",
    ublDocument: prebuildInvoiceUBL({
      invoice,
      supplierAddress: senderAddress,
      customerAddress: recipientAddress,
      isDocumentValidationEnforced,
    }),
  });
}
