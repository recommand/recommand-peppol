import { XMLParser } from "fast-xml-parser";
import { getTextContent } from "../xml-helpers";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

/**
 * CII carries invoices and credit notes under a single document type identifier, told
 * apart by the document type code on the exchanged document. Reading it is what lets a
 * reader pick between the two without a separate identifier to dispatch on.
 *
 * Returns null for any other type code, which the callers read as "not one of ours".
 */
export function getCiiTypeCode(xml: string): "380" | "381" | null {
  const parsed = parser.parse(xml);
  const typeCode = getTextContent(
    parsed.CrossIndustryInvoice?.ExchangedDocument?.TypeCode
  );
  return typeCode === "380" || typeCode === "381" ? typeCode : null;
}
