import { UserFacingError, cleanEnterpriseNumber } from "@peppol/utils/util";
import { passesLuhn } from "../checksums";
import type { CountryIdentifierRules } from "../validators";

export function isSiren(digits: string): boolean {
  return /^\d{9}$/.test(digits) && passesLuhn(digits);
}

export function isSiret(digits: string): boolean {
  return /^\d{14}$/.test(digits) && passesLuhn(digits);
}

/**
 * A French electronic address (ICD 0225) names the company by its SIREN or one
 * of its establishments by its SIRET, and may carry the routing suffixes of the
 * annuaire behind it: SIREN_SUFFIXE, SIREN_SIRET and SIREN_SIRET_CODEROUTAGE.
 */
export function validateFrenchElectronicAddress(identifier: string): void {
  const value = identifier.replace(/\s/g, "").toUpperCase();

  if (!/^\d{9}(\d{5})?(_[A-Z0-9-]+)*$/.test(value)) {
    throw new UserFacingError(
      "French electronic address must be a 9 digit SIREN or a 14 digit SIRET, optionally followed by routing suffixes separated by underscores (got '" +
        identifier +
        "')"
    );
  }

  // The company number the address opens with, and the SIRET of the
  // SIREN_SIRET forms, are the parts that carry a check digit.
  const parts = value.split("_");
  for (const number of [parts[0], parts[1]]) {
    if (number && /^\d{9}$|^\d{14}$/.test(number) && !passesLuhn(number)) {
      throw new UserFacingError(
        "French electronic address contains " +
          number +
          ", which has an invalid check digit"
      );
    }
  }
}

export function validateFrenchSiren(identifier: string): void {
  const digits = identifier.replace(/[\.\-\s]/g, "");

  if (!/^\d{9}$/.test(digits)) {
    throw new UserFacingError(
      "French SIREN must be exactly 9 digits (got " + digits.length + ")"
    );
  }

  if (!passesLuhn(digits)) {
    throw new UserFacingError("French SIREN has an invalid check digit");
  }
}

export function validateFrenchSiret(identifier: string): void {
  const digits = identifier.replace(/[\.\-\s]/g, "");

  if (!/^\d{14}$/.test(digits)) {
    throw new UserFacingError(
      "French SIRET must be exactly 14 digits (got " + digits.length + ")"
    );
  }

  if (!passesLuhn(digits)) {
    throw new UserFacingError("French SIRET has an invalid check digit");
  }
}

export function validateFrenchVatNumber(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();

  if (!cleaned.startsWith("FR")) {
    throw new UserFacingError("French VAT number must start with 'FR'");
  }

  const afterPrefix = cleaned.substring(2);

  // The two character key is alphanumeric, but never uses the letters I and O.
  if (!/^[0-9A-HJ-NP-Z]{2}\d{9}$/.test(afterPrefix)) {
    throw new UserFacingError(
      "French VAT number must have the format FR + a 2 character key + a 9 digit SIREN (e.g. FR40303265045)"
    );
  }

  const key = afterPrefix.substring(0, 2);
  const siren = afterPrefix.substring(2);

  if (!passesLuhn(siren)) {
    throw new UserFacingError(
      "French VAT number contains SIREN " + siren + ", which has an invalid check digit"
    );
  }

  // Only the numeric key is computed from the SIREN; the alphanumeric ones the
  // administration assigns cannot be checked.
  if (/^\d{2}$/.test(key)) {
    const expected = (12 + 3 * (parseInt(siren, 10) % 97)) % 97;
    if (parseInt(key, 10) !== expected) {
      throw new UserFacingError("French VAT number has an invalid key");
    }
  }
}

/**
 * The SIREN a French company is identified by for tax purposes. Companies register
 * either their SIREN (9 digits) or the SIRET of an establishment (14 digits, the
 * SIREN followed by a 5-digit NIC); both name the same legal entity. Returns null
 * when the number is neither, or fails its check digit.
 */
export function getFrenchSiren(enterpriseNumber: string | null | undefined): string | null {
  const digits = enterpriseNumber?.replace(/[\s.-]/g, "") ?? "";
  if (isSiren(digits)) {
    return digits;
  }
  if (isSiret(digits)) {
    return digits.slice(0, 9);
  }
  return null;
}

export const FRENCH_COMPANY_SCHEMES = ["0225", "0002", "0009"];

/**
 * The identifiers a company may register under a French scheme all have to name
 * the company itself: its SIREN, the SIRET of one of its establishments, or an
 * electronic address of either, all of which open with that SIREN. The form of
 * each scheme is settled by validateIdentifier before this runs.
 */
export function validateFrenchIdentifierBelongsToCompany(scheme: string, identifier: string, enterpriseNumber: string | null): void {
  const companySiren = cleanEnterpriseNumber(enterpriseNumber);

  if (!companySiren) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} requires a company enterprise number to be set.`);
  }

  if (!isSiren(companySiren)) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} requires the company enterprise number to be a valid SIREN, got: ${companySiren}`);
  }

  const cleanedIdentifier = cleanEnterpriseNumber(identifier)!;

  if (!cleanedIdentifier.startsWith(companySiren)) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} must belong to the company. Expected the company SIREN ${companySiren}, or a SIRET or address starting with it. Got: ${identifier}`);
  }
}

export const france: CountryIdentifierRules = {
  country: "FR",
  vatNumber: validateFrenchVatNumber,
  enterpriseNumber: validateFrenchSiren,
  schemes: {
    "0002": validateFrenchSiren,
    "0009": validateFrenchSiret,
    // France's default scheme: an electronic address opening with the SIREN.
    "0225": validateFrenchElectronicAddress,
  },
  companyIdentifiers: {
    schemes: FRENCH_COMPANY_SCHEMES,
    validate: (scheme, identifier, company) => validateFrenchIdentifierBelongsToCompany(scheme, identifier, company.enterpriseNumber),
  },
};
