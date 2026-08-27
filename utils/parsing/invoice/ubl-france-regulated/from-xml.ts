import { parseFrenchRegulatedFieldsFromUBL } from "../../ubl-france-regulated/from-xml";
import { parseInvoiceFromXML } from "../peppol-ubl-bis3/from-xml";
import { invoiceSchema, type Invoice } from "../schemas";

export function parseFrenchRegulatedInvoiceFromUBL(xml: string): Invoice {
  return invoiceSchema.parse({
    ...parseInvoiceFromXML(xml),
    ...parseFrenchRegulatedFieldsFromUBL(xml, "Invoice"),
  });
}
