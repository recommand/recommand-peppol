import { XMLBuilder } from "fast-xml-parser";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";
import type { CreditNote } from "../creditnote/schemas";
import type { Invoice } from "../invoice/schemas";
import { validateFrenchRegulatedBillingDocument } from "../france-regulated/validation";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

export function frenchRegulatedBillingDocumentToUBL({
  document,
  profile,
  rootName,
  ublDocument,
}: {
  document: Invoice | CreditNote;
  profile: XmlProfile;
  rootName: "Invoice" | "CreditNote";
  ublDocument: Record<string, Record<string, unknown>>;
}): string {
  const countrySpecific = validateFrenchRegulatedBillingDocument(document);
  const root = ublDocument[rootName];

  root["cbc:CustomizationID"] = profile.customizationId;
  root["cbc:ProfileID"] = countrySpecific.billingMode;
  root["cbc:Note"] = [
    ...(document.note ? [document.note] : []),
    `#PMT#${countrySpecific.recoveryCostsNote}`,
    `#PMD#${countrySpecific.latePaymentPenaltiesNote}`,
    `#AAB#${countrySpecific.earlyPaymentDiscountNote}`,
  ];

  return builder.build(ublDocument);
}
