import type { CreditNote } from "../schemas";
import { billingDocumentToCII } from "../../cii-d22b/to-xml";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";

export function creditNoteToCII({
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
  return billingDocumentToCII({
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
