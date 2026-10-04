import { UserFacingError } from "@peppol/utils/util";
import type { CountryIdentifierRules } from "../validators";

export function validateLuxembourgVatNumber(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();

  if (!cleaned.startsWith("LU")) {
    throw new UserFacingError("Luxembourg VAT number must start with 'LU'");
  }

  const digits = cleaned.substring(2);

  if (!/^\d{8}$/.test(digits)) {
    throw new UserFacingError(
      "Luxembourg VAT number must have the format LU + 8 digits (e.g. LU15027442)"
    );
  }

  // The last two digits are the first six modulo 89.
  if (Number(digits.substring(0, 6)) % 89 !== Number(digits.substring(6))) {
    throw new UserFacingError("Luxembourg VAT number has an invalid check digit");
  }
}

export const luxembourg: CountryIdentifierRules = {
  country: "LU",
  vatNumber: validateLuxembourgVatNumber,
};
