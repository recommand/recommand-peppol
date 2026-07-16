import {
  CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
  type DocumentTypeInfo,
} from "@peppol/utils/document-types";
import { frenchRegulatedBillingDocumentToCII } from "../../cii-d22b/france-regulated/to-xml";
import type { CreditNote } from "../schemas";

export function frenchRegulatedCreditNoteToCII({
  creditNote,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
  documentTypeInfo = CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
}: {
  creditNote: CreditNote;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
  documentTypeInfo?: DocumentTypeInfo;
}): string {
  return frenchRegulatedBillingDocumentToCII({
    document: creditNote,
    documentTypeInfo,
    documentNumber: creditNote.creditNoteNumber,
    typeCode: "381",
    supplierAddress: senderAddress,
    customerAddress: recipientAddress,
    isDocumentValidationEnforced,
    invoiceReferences: creditNote.invoiceReferences,
  });
}
