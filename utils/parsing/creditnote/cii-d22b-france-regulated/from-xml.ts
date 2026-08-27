import { parseFrenchRegulatedBillingDocumentFromCII } from "../../cii-d22b/france-regulated/from-xml";
import { creditNoteSchema, type CreditNote } from "../schemas";

export function parseFrenchRegulatedCreditNoteFromCII(xml: string): CreditNote {
  const { documentNumber, typeCode, dueDate, ...document } =
    parseFrenchRegulatedBillingDocumentFromCII(xml);
  void typeCode;
  void dueDate;

  return creditNoteSchema.parse({
    ...document,
    creditNoteNumber: documentNumber,
  });
}
