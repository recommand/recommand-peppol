import { parseFrenchRegulatedBillingDocumentFromCII } from "../../cii-d22b/france-regulated/from-xml";
import { invoiceSchema, type Invoice } from "../schemas";

export function parseFrenchRegulatedInvoiceFromCII(xml: string): Invoice {
  const { documentNumber, typeCode, invoiceReferences, ...document } =
    parseFrenchRegulatedBillingDocumentFromCII(xml);
  void typeCode;
  void invoiceReferences;

  return invoiceSchema.parse({
    ...document,
    invoiceNumber: documentNumber,
  });
}
