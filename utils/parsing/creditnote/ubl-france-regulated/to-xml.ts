import { UBL_FRANCE_CREDIT_NOTE_CIUS_DOCUMENT_TYPE_INFO } from "@peppol/utils/document-types";
import { frenchRegulatedBillingDocumentToUBL } from "../../ubl-france-regulated/to-xml";
import { prebuildCreditNoteUBL } from "../peppol-ubl-bis3/to-xml";
import type { CreditNote } from "../schemas";

export function frenchRegulatedCreditNoteToUBL({
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
  return frenchRegulatedBillingDocumentToUBL({
    document: creditNote,
    documentTypeInfo: UBL_FRANCE_CREDIT_NOTE_CIUS_DOCUMENT_TYPE_INFO,
    rootName: "CreditNote",
    ublDocument: prebuildCreditNoteUBL({
      creditNote,
      supplierAddress: senderAddress,
      customerAddress: recipientAddress,
      isDocumentValidationEnforced,
    }),
  });
}
