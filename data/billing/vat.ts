import {
  billingProfiles,
} from "@peppol/db/schema";
import Decimal from "decimal.js";
import { cleanVatNumber } from "@peppol/utils/util";
import { COUNTRIES } from "@peppol/utils/countries";
import type { VatCategory } from "@peppol/utils/parsing/invoice/schemas";

export function determineVatStrategy(billingProfile: typeof billingProfiles.$inferSelect): { percentage: Decimal, vatCategory: VatCategory, vatExemptionReason: string | null } {
  // Clean the vat number
  let vatNumber = cleanVatNumber(billingProfile.vatNumber);
  if (!vatNumber) {
    return { percentage: new Decimal(21), vatCategory: "S", vatExemptionReason: null }; // 21% VAT (treated as a consumer in Belgium)
  }

  // Get the country code from the vat number, if it's not a valid country code, use the billing profile country
  let countryCode = vatNumber.substring(0, 2);
  if (!COUNTRIES.some(country => country.code === countryCode)) {
    countryCode = billingProfile.country;
    vatNumber = countryCode + vatNumber.substring(2);
  }

  // Get the vat percentage for the country
  switch (countryCode) {
    case "BE":
      return { percentage: new Decimal(21), vatCategory: "S", vatExemptionReason: null }; // 21% VAT
    default:
      return { percentage: new Decimal(0), vatCategory: "AE", vatExemptionReason: "Reverse charge mechanism - Article 196 of VAT Directive 2006/112/EC" }; // VAT Reverse Charge
  }

}