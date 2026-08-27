import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";
import { prebuildCreditNoteUBL } from "../creditnote/peppol-ubl-bis3/to-xml";
import type { SelfBillingCreditNote } from "./schemas";
import { XMLBuilder } from "fast-xml-parser";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

export function selfBillingCreditNoteToUBL(
  {
    selfBillingCreditNote,
    senderAddress,
    recipientAddress,
    isDocumentValidationEnforced,
    profile,
  }: {
    selfBillingCreditNote: SelfBillingCreditNote;
    senderAddress: string;
    recipientAddress: string;
    isDocumentValidationEnforced: boolean;
    profile: XmlProfile;
  }): string {
  // The self billing credit note is the same as the credit note with a different invoice type code (389 instead of 380)
  const ublCreditNote = prebuildCreditNoteUBL({
    creditNote: selfBillingCreditNote,
    supplierAddress: recipientAddress,
    customerAddress: senderAddress,
    isDocumentValidationEnforced,
    profile,
  });

  // Set the invoice type code to 389
  ublCreditNote.CreditNote["cbc:CreditNoteTypeCode"] = "261";

  return builder.build(ublCreditNote);
}
