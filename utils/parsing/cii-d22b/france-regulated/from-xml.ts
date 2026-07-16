import { XMLParser } from "fast-xml-parser";
import { frenchBillingModeSchema } from "../../country-specific/france";
import { getTextContent } from "../../xml-helpers";
import { parseBillingDocumentFromCII } from "../from-xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "IncludedNote",
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
});

export function parseFrenchRegulatedBillingDocumentFromCII(xml: string) {
  const document = parseBillingDocumentFromCII(xml);
  const parsed = parser.parse(xml);
  const invoice = parsed.CrossIndustryInvoice;
  const notes = invoice?.ExchangedDocument?.IncludedNote ?? [];
  const note = (subjectCode: string) =>
    getTextContent(
      notes.find(
        (item: any) => getTextContent(item.SubjectCode) === subjectCode
      )?.Content
    );
  const billingMode = frenchBillingModeSchema.parse(
    getTextContent(
      invoice?.ExchangedDocumentContext
        ?.BusinessProcessSpecifiedDocumentContextParameter?.ID
    )
  );

  return {
    ...document,
    countrySpecific: {
      country: "FR" as const,
      billingMode,
      recoveryCostsNote: note("PMT"),
      latePaymentPenaltiesNote: note("PMD"),
      earlyPaymentDiscountNote: note("AAB"),
    },
  };
}
