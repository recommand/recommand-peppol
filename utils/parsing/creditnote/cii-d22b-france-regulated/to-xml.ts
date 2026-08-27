import { frenchRegulatedBillingDocumentToCII } from "../../cii-d22b/france-regulated/to-xml";
import type { CreditNote } from "../schemas";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";

export function frenchRegulatedCreditNoteToCII({
  creditNote,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
  profile,
}: {
  creditNote: CreditNote;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
  profile: XmlProfile;
}): string {
  return frenchRegulatedBillingDocumentToCII({
    document: creditNote,
    profile,
    documentNumber: creditNote.creditNoteNumber,
    typeCode: "381",
    supplierAddress: senderAddress,
    customerAddress: recipientAddress,
    isDocumentValidationEnforced,
    invoiceReferences: creditNote.invoiceReferences,
  });
}
