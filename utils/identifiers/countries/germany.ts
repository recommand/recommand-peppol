import { UserFacingError } from "@peppol/utils/util";
import { mod97, lettersToDigits, passesMod11_10 } from "../checksums";
import type { CountryIdentifierRules } from "../validators";

/**
 * The German VAT identification number (USt-IdNr.): DE followed by nine digits, the
 * last of which is an ISO/IEC 7064 MOD 11,10 check digit over the first eight.
 */
export function validateGermanVatNumber(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();

  if (!cleaned.startsWith("DE")) {
    throw new UserFacingError("German VAT number must start with 'DE'");
  }

  const digits = cleaned.substring(2);

  if (!/^\d{9}$/.test(digits)) {
    throw new UserFacingError(
      "German VAT number must have exactly 9 digits after the DE prefix (got " +
        digits.length +
        ")"
    );
  }

  if (!passesMod11_10(digits)) {
    throw new UserFacingError("German VAT number has an invalid check digit");
  }
}

/**
 * A Leitweg-ID (ICD 0204) addresses a German public authority's invoice reception:
 * a numeric coarse address of 2 to 12 digits, an optional alphanumeric fine address
 * of up to 30 characters and two check digits, separated by hyphens, for example
 * 991-33333TEST-33. The check digits are ISO/IEC 7064 MOD 97-10 over the two
 * addresses, as the KoSIT format and check digit specification defines them.
 */
export function validateLeitwegId(identifier: string): void {
  const value = identifier.trim().toUpperCase();
  const match = /^(\d{2,12})(?:-([A-Z0-9]{1,30}))?-(\d{2})$/.exec(value);

  if (!match) {
    throw new UserFacingError(
      "Leitweg-ID must consist of a 2 to 12 digit coarse address, an optional fine address of up to 30 letters or digits and 2 check digits, separated by hyphens (e.g. 991-33333TEST-33). Got: '" +
        identifier +
        "'"
    );
  }

  const [, coarse, fine = "", checkDigits] = match;
  if (mod97(lettersToDigits(coarse + fine) + checkDigits) !== 1) {
    throw new UserFacingError(
      "Leitweg-ID " + identifier + " has invalid check digits. Ask the public authority you invoice for its exact Leitweg-ID."
    );
  }
}

/** Scheme 9958 was the Leitweg-ID's first ICD. Peppol deprecated it in favour of 0204. */
export function rejectDeprecatedLeitwegIdScheme(): void {
  throw new UserFacingError(
    "Scheme 9958 is deprecated and can no longer be used on the Peppol network. German public authorities are addressed by their Leitweg-ID under scheme 0204."
  );
}

export const germany: CountryIdentifierRules = {
  country: "DE",
  vatNumber: validateGermanVatNumber,
  schemes: {
    "0204": validateLeitwegId,
    "9958": rejectDeprecatedLeitwegIdScheme,
  },
};
