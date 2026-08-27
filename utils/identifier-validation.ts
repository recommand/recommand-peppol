import { UserFacingError } from "@peppol/utils/util";

type IdentifierValidator = (identifier: string) => void;
type CountryIdentifierValidators = {
  vatNumber?: IdentifierValidator;
  enterpriseNumber?: IdentifierValidator;
};

function validateBelgianEnterpriseNumber(identifier: string): void {
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

function validateBelgianVatNumber(identifier: string): void {
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

function validateDutchEnterpriseNumber(identifier: string): void {
  const digits = identifier.replace(/[\.\-\s]/g, "");

  if (!/^\d{8}$/.test(digits)) {
    throw new UserFacingError(
      "Dutch enterprise number (KVK) must be exactly 8 digits (got " +
        digits.length +
        ")"
    );
  }
}

function validateDutchVatNumber(identifier: string): void {
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

function validateDanishOrganizationNumber(identifier: string): void {
  if (!/^(DK)?\d{8}$/.test(identifier.toUpperCase())) {
    throw new UserFacingError(
      "Danish organization number (CVR) must be 8 digits, optionally prefixed with 'DK'"
    );
  }
}

/**
 * The Luhn checksum every SIREN and SIRET carries in its last digit.
 */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

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
function validateFrenchElectronicAddress(identifier: string): void {
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

function validateFrenchSiren(identifier: string): void {
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

function validateFrenchSiret(identifier: string): void {
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

function validateFrenchVatNumber(identifier: string): void {
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

const schemeValidators: Record<string, IdentifierValidator> = {
  "0184": validateDanishOrganizationNumber,
  "0208": validateBelgianEnterpriseNumber,
  "9925": validateBelgianVatNumber,
  "0106": validateDutchEnterpriseNumber,
  "9944": validateDutchVatNumber,
  "0002": validateFrenchSiren,
  "0009": validateFrenchSiret,
  "0225": validateFrenchElectronicAddress,
  "9957": validateFrenchVatNumber,
};

const countryValidators: Record<string, CountryIdentifierValidators> = {
  "BE": {
    vatNumber: validateBelgianVatNumber,
    enterpriseNumber: validateBelgianEnterpriseNumber,
  },
  "NL": {
    vatNumber: validateDutchVatNumber,
    enterpriseNumber: validateDutchEnterpriseNumber,
  },
  "FR": {
    vatNumber: validateFrenchVatNumber,
    enterpriseNumber: validateFrenchSiren,
  },
};

export function validateIdentifier(
  scheme: string,
  identifier: string,
): void {
  const validator = schemeValidators[scheme];
  if (!validator) {
    return;
  }
  validator(identifier);
}

export function validateCountryIdentifier(
  country: string,
  identifiers: {
    vatNumber?: string | null;
    enterpriseNumber?: string | null;
  },
): void {
  const validator = countryValidators[country];
  if (!validator) {
    return;
  }
  if (identifiers.vatNumber && validator.vatNumber) {
    validator.vatNumber(identifiers.vatNumber);
  }
  if (identifiers.enterpriseNumber && validator.enterpriseNumber) {
    validator.enterpriseNumber(identifiers.enterpriseNumber);
  }
}
