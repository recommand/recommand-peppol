import { frenchRegulatedBillingDocumentToUBL } from "../../ubl-france-regulated/to-xml";
import { prebuildCreditNoteUBL } from "../peppol-ubl-bis3/to-xml";
import type { CreditNote } from "../schemas";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";

export function frenchRegulatedCreditNoteToUBL({
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
  return frenchRegulatedBillingDocumentToUBL({
    document: creditNote,
    profile,
    rootName: "CreditNote",
    ublDocument: prebuildCreditNoteUBL({
      creditNote,
      supplierAddress: senderAddress,
      customerAddress: recipientAddress,
      isDocumentValidationEnforced,
      profile,
    }),
  });
}
