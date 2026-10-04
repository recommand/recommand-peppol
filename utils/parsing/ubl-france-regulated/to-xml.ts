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

  // The builder writes elements in key order, and the UBL schema puts cbc:Note
  // right after the type code. Assigning the key would append it after the lines
  // when the document has no note of its own, so rebuild the element with the
  // notes in place.
  const notes = [
    ...(document.note ? [document.note] : []),
    `#PMT#${countrySpecific.recoveryCostsNote}`,
    `#PMD#${countrySpecific.latePaymentPenaltiesNote}`,
    `#AAB#${countrySpecific.earlyPaymentDiscountNote}`,
  ];
  const typeCodeKey =
    rootName === "Invoice" ? "cbc:InvoiceTypeCode" : "cbc:CreditNoteTypeCode";
  const entries = Object.entries(root).filter(([key]) => key !== "cbc:Note");
  const typeCodeIndex = entries.findIndex(([key]) => key === typeCodeKey);
  if (typeCodeIndex === -1) {
    throw new Error(`UBL ${rootName} has no ${typeCodeKey} to place the notes after`);
  }
  entries.splice(typeCodeIndex + 1, 0, ["cbc:Note", notes]);
  ublDocument[rootName] = Object.fromEntries(entries);

  return builder.build(ublDocument);
}
