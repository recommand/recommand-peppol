import { UserFacingError, cleanVatNumber } from "@peppol/utils/util";
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

export const GEBA_SCHEME = "0246";

/** A GEBA: the W-IdNr, an optional distinctive feature and an optional sub-address. */
const GEBA = /^(DE\d{9})(?:-\d{5})?(?:\.[0-9A-Z]{1,8})?$/;

/**
 * The German Electronic Business Address (GEBA, ICD 0246), the identifier KoSIT
 * recommends to private businesses: the Business Identification Number
 * (Wirtschafts-Identifikationsnummer, W-IdNr), DE and 9 digits, optionally followed by
 * a hyphen and the 5 digit distinctive feature (Unterscheidungsmerkmal) and by a full
 * stop and a sub-address of 1 to 8 letters or digits, e.g. DE136695976-00001.ABT1.
 * The ninth digit is a check digit over the eight before it. Source: Peppol participant
 * identifier schemes v9.7, DE:GEBA. The W-IdNr has the same value as the business's
 * VAT number (KoSIT, Germany Identifier Guideline v1.3), so its check digit is the
 * VAT number's.
 */
export function validateGeba(identifier: string): void {
  const match = GEBA.exec(identifier.trim().toUpperCase());
  if (!match) {
    throw new UserFacingError(
      "GEBA must be the W-IdNr (DE + 9 digits), optionally followed by a hyphen and its 5 digit distinctive feature and by a full stop and a sub-address of up to 8 letters or digits (e.g. DE136695976 or DE136695976-00001)"
    );
  }
  if (!passesMod11_10(match[1]!.substring(2))) {
    throw new UserFacingError("GEBA contains a W-IdNr with an invalid check digit");
  }
}

/**
 * A GEBA names the business its W-IdNr belongs to, which is the business whose VAT
 * number has the same value. The distinctive feature and the sub-address are the
 * company's to choose.
 */
function validateGebaBelongsToCompany(
  scheme: string,
  identifier: string,
  company: { enterpriseNumber: string | null; vatNumber: string | null }
): void {
  const vatNumber = cleanVatNumber(company.vatNumber);
  if (!vatNumber) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} requires a company VAT number to be set.`);
  }
  const businessIdentificationNumber = GEBA.exec(identifier.trim().toUpperCase())?.[1];
  if (businessIdentificationNumber !== vatNumber) {
    throw new UserFacingError(
      `Company identifier with scheme ${scheme} must start with the company VAT number, which is its W-IdNr. Expected: ${vatNumber}, got: ${identifier}`
    );
  }
}

export const germany: CountryIdentifierRules = {
  country: "DE",
  vatNumber: validateGermanVatNumber,
  schemes: {
    "0204": validateLeitwegId,
    "9958": rejectDeprecatedLeitwegIdScheme,
    [GEBA_SCHEME]: validateGeba,
  },
  companyIdentifiers: {
    schemes: [GEBA_SCHEME],
    validate: validateGebaBelongsToCompany,
  },
};
