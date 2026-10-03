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

function validateCypriotVatNumber(identifier: string): void {
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

/** ISO/IEC 7064 MOD 97-10 over a string of digits: 1 when its check digits are right. */
function mod97(digits: string): number {
  let remainder = 0;
  for (const digit of digits) {
    remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder;
}

/** Letters as the two digit numbers MOD 97-10 reads them as: A is 10, Z is 35. */
function lettersToDigits(value: string): string {
  return value.toUpperCase().replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
}

/**
 * The German VAT identification number (USt-IdNr.): DE followed by nine digits, the
 * last of which is an ISO/IEC 7064 MOD 11,10 check digit over the first eight.
 */
function validateGermanVatNumber(identifier: string): void {
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

  let product = 10;
  for (let index = 0; index < 8; index++) {
    let sum = (digits.charCodeAt(index) - 48 + product) % 10;
    if (sum === 0) {
      sum = 10;
    }
    product = (2 * sum) % 11;
  }
  const checkDigit = (11 - product) % 10;

  if (checkDigit !== digits.charCodeAt(8) - 48) {
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
function rejectDeprecatedLeitwegIdScheme(): void {
  throw new UserFacingError(
    "Scheme 9958 is deprecated and can no longer be used on the Peppol network. German public authorities are addressed by their Leitweg-ID under scheme 0204."
  );
}

/** A GS1 Global Location Number: 13 digits, the last a GS1 modulo 10 check digit. */
function validateGln(identifier: string): void {
  const digits = identifier.replace(/[\s-]/g, "");

  if (!/^\d{13}$/.test(digits)) {
    throw new UserFacingError(
      "GLN must be exactly 13 digits (got " + digits.length + ")"
    );
  }

  let sum = 0;
  for (let index = 0; index < 12; index++) {
    sum += (digits.charCodeAt(index) - 48) * (index % 2 === 0 ? 1 : 3);
  }

  if ((10 - (sum % 10)) % 10 !== digits.charCodeAt(12) - 48) {
    throw new UserFacingError("GLN has an invalid check digit");
  }
}

/** An IBAN: country code, two check digits and up to 30 letters or digits. */
function validateIban(identifier: string): void {
  const value = identifier.replace(/\s/g, "").toUpperCase();

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) {
    throw new UserFacingError(
      "IBAN must start with a 2 letter country code and 2 check digits, followed by the account number (e.g. DE89370400440532013000)"
    );
  }

  if (mod97(lettersToDigits(value.substring(4) + value.substring(0, 4))) !== 1) {
    throw new UserFacingError("IBAN has invalid check digits");
  }
}

const schemeValidators: Record<string, IdentifierValidator> = {
  "0184": validateDanishOrganizationNumber,
  "0208": validateBelgianEnterpriseNumber,
  "9925": validateBelgianVatNumber,
  "9928": validateCypriotVatNumber,
  "0106": validateDutchEnterpriseNumber,
  "9944": validateDutchVatNumber,
  "0002": validateFrenchSiren,
  "0009": validateFrenchSiret,
  "0225": validateFrenchElectronicAddress,
  "9957": validateFrenchVatNumber,
  "0204": validateLeitwegId,
  "9958": rejectDeprecatedLeitwegIdScheme,
  "9930": validateGermanVatNumber,
  "0088": validateGln,
  "9918": validateIban,
};

const countryValidators: Record<string, CountryIdentifierValidators> = {
  "BE": {
    vatNumber: validateBelgianVatNumber,
    enterpriseNumber: validateBelgianEnterpriseNumber,
  },
  "CY": {
    vatNumber: validateCypriotVatNumber,
  },
  "NL": {
    vatNumber: validateDutchVatNumber,
    enterpriseNumber: validateDutchEnterpriseNumber,
  },
  "FR": {
    vatNumber: validateFrenchVatNumber,
    enterpriseNumber: validateFrenchSiren,
  },
  "DE": {
    vatNumber: validateGermanVatNumber,
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
