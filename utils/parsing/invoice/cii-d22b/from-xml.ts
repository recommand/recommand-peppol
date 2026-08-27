import { invoiceSchema, type Invoice } from "../schemas";
import { parseBillingDocumentFromCII } from "../../cii-d22b/from-xml";

export function parseInvoiceFromCII(xml: string): Invoice {
  const { documentNumber, typeCode, invoiceReferences, ...document } = parseBillingDocumentFromCII(xml);
  void typeCode;
  void invoiceReferences;

  return invoiceSchema.parse({
    ...document,
    invoiceNumber: documentNumber,
  });
}
