import { XMLParser } from "fast-xml-parser";
import { frenchBillingModeSchema } from "../country-specific/france";
import { getNullableTextContent, getTextContent } from "../xml-helpers";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name, jpath) =>
    name === "Note" &&
    (jpath === "Invoice.Note" || jpath === "CreditNote.Note"),
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
});

export function parseFrenchRegulatedFieldsFromUBL(
  xml: string,
  rootName: "Invoice" | "CreditNote"
) {
  const parsed = parser.parse(xml);
  const root = parsed[rootName];
  if (!root) {
    throw new Error(`Invalid XML: No ${rootName} element found`);
  }
  const notes = root.Note ?? [];
  const structuredNote = (item: unknown) =>
    getTextContent(item).match(/^#([^#]+)#([\s\S]*)$/);
  const note = (subjectCode: string) =>
    structuredNote(
      notes.find((item: unknown) => structuredNote(item)?.[1] === subjectCode)
    )?.[2] ?? "";
  const generalNote = notes.find((item: unknown) => !structuredNote(item));

  return {
    note: getNullableTextContent(generalNote),
    countrySpecific: {
      country: "FR" as const,
      billingMode: frenchBillingModeSchema.parse(
        getTextContent(root.ProfileID)
      ),
      recoveryCostsNote: note("PMT"),
      latePaymentPenaltiesNote: note("PMD"),
      earlyPaymentDiscountNote: note("AAB"),
    },
  };
}
