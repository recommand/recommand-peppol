import { UserFacingError } from "@peppol/utils/util";
import type { CountryIdentifierRules } from "../validators";

export function validateDutchEnterpriseNumber(identifier: string): void {
  const digits = identifier.replace(/[\.\-\s]/g, "");

  if (!/^\d{8}$/.test(digits)) {
    throw new UserFacingError(
      "Dutch enterprise number (KVK) must be exactly 8 digits (got " +
        digits.length +
        ")"
    );
  }
}

export function validateDutchVatNumber(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();

  if (!cleaned.startsWith("NL")) {
    throw new UserFacingError("Dutch VAT number must start with 'NL'");
  }

  const afterPrefix = cleaned.substring(2);

  if (!/^\d{9}B\d{2}$/.test(afterPrefix)) {
    throw new UserFacingError(
      "Dutch VAT number must have the format NL + 9 digits + B + 2 digits (e.g. NL123456789B01)"
    );
  }
}

export const netherlands: CountryIdentifierRules = {
  country: "NL",
  vatNumber: validateDutchVatNumber,
  enterpriseNumber: validateDutchEnterpriseNumber,
};
