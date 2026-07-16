import { getCustomizationId, SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO } from "@peppol/utils/document-types";
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
  }: {
    selfBillingCreditNote: SelfBillingCreditNote;
    senderAddress: string;
    recipientAddress: string;
    isDocumentValidationEnforced: boolean;
  }): string {
  // The self billing credit note is the same as the credit note with a different invoice type code (389 instead of 380)
  const ublCreditNote = prebuildCreditNoteUBL({
    creditNote: selfBillingCreditNote,
    supplierAddress: recipientAddress,
    customerAddress: senderAddress,
    isDocumentValidationEnforced,
  });

  // Set the CustomizationID
  ublCreditNote.CreditNote["cbc:CustomizationID"] = getCustomizationId(SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO);
  // Set the ProfileID
  ublCreditNote.CreditNote["cbc:ProfileID"] = SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO.processId;
  // Set the invoice type code to 389
  ublCreditNote.CreditNote["cbc:CreditNoteTypeCode"] = "261";

  return builder.build(ublCreditNote);
}
