import { creditNoteSchema, type CreditNote } from "../schemas";
import { parseBillingDocumentFromCII } from "../../cii-d22b/from-xml";

export function parseCreditNoteFromCII(xml: string): CreditNote {
  const { documentNumber, typeCode, dueDate, ...document } = parseBillingDocumentFromCII(xml);
  void typeCode;
  void dueDate;

  return creditNoteSchema.parse({
    ...document,
    creditNoteNumber: documentNumber,
  });
}
