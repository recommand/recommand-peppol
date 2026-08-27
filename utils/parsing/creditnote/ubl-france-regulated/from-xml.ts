import { parseFrenchRegulatedFieldsFromUBL } from "../../ubl-france-regulated/from-xml";
import { parseCreditNoteFromXML } from "../peppol-ubl-bis3/from-xml";
import { creditNoteSchema, type CreditNote } from "../schemas";

export function parseFrenchRegulatedCreditNoteFromUBL(xml: string): CreditNote {
  return creditNoteSchema.parse({
    ...parseCreditNoteFromXML(xml),
    ...parseFrenchRegulatedFieldsFromUBL(xml, "CreditNote"),
  });
}
