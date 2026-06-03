import type { CreditNote } from "../schemas";
import { CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO } from "@peppol/utils/document-types";
import { billingDocumentToCII } from "../../cii-d22b/to-xml";

export function creditNoteToCII({
  creditNote,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
}: {
  creditNote: CreditNote;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
}): string {
  return billingDocumentToCII({
    document: creditNote,
    documentTypeInfo: CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
    documentNumber: creditNote.creditNoteNumber,
    typeCode: "381",
    supplierAddress: senderAddress,
    customerAddress: recipientAddress,
    isDocumentValidationEnforced,
    invoiceReferences: creditNote.invoiceReferences,
  });
}
