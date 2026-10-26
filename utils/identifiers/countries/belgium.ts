import { UserFacingError } from "@peppol/utils/util";
import type { CountryIdentifierRules } from "../validators";

export function validateBelgianEnterpriseNumber(identifier: string): void {
  const digits = identifier.replace(/[\.\-\s]/g, "");

  if (!/^\d{10}$/.test(digits)) {
    throw new UserFacingError(
      "Belgian enterprise number must be exactly 10 digits (got " +
        digits.length +
        ")"
    );
  }

  if (digits[0] !== "0" && digits[0] !== "1") {
    throw new UserFacingError(
      "Belgian enterprise number must start with 0 or 1"
    );
  }

  const base = parseInt(digits.substring(0, 8), 10);
  const checkDigits = parseInt(digits.substring(8, 10), 10);
  const expected = 97 - (base % 97);

  if (checkDigits !== expected) {
    throw new UserFacingError(
      "Belgian enterprise number has an invalid check digit"
    );
  }
}

export function validateBelgianVatNumber(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();

  if (!cleaned.startsWith("BE")) {
    throw new UserFacingError("Belgian VAT number must start with 'BE'");
  }

  const numericPart = cleaned.substring(2);

  if (!/^\d{10}$/.test(numericPart)) {
    throw new UserFacingError(
      "Belgian VAT number must have exactly 10 digits after the BE prefix (got " +
        numericPart.length +
        ")"
    );
  }

  if (numericPart[0] !== "0" && numericPart[0] !== "1") {
    throw new UserFacingError(
      "Belgian VAT number must start with BE0 or BE1"
    );
  }

  const base = parseInt(numericPart.substring(0, 8), 10);
  const checkDigits = parseInt(numericPart.substring(8, 10), 10);
  const expected = 97 - (base % 97);

  if (checkDigits !== expected) {
    throw new UserFacingError(
      "Belgian VAT number has an invalid check digit"
    );
  }
}

export const belgium: CountryIdentifierRules = {
  country: "BE",
  vatNumber: validateBelgianVatNumber,
  enterpriseNumber: validateBelgianEnterpriseNumber,
};
