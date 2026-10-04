import { UserFacingError } from "@peppol/utils/util";
import type { CountryIdentifierRules } from "../validators";

export function validateCypriotVatNumber(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();

  if (!cleaned.startsWith("CY")) {
    throw new UserFacingError("Cypriot VAT number must start with 'CY'");
  }

  const afterPrefix = cleaned.substring(2);

  // The Cypriot TIC is eight digits followed by a single check letter.
  if (!/^\d{8}[A-Z]$/.test(afterPrefix)) {
    throw new UserFacingError(
      "Cypriot VAT number must have the format CY + 8 digits + 1 letter (e.g. CY12345678L)"
    );
  }
}

export const cyprus: CountryIdentifierRules = {
  country: "CY",
  vatNumber: validateCypriotVatNumber,
};
