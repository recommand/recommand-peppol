import { COUNTRIES, getCountryName } from "@peppol/utils/countries";
import { UserFacingError, cleanEnterpriseNumber, cleanVatNumber } from "@peppol/utils/util";

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

function validateLuxembourgVatNumber(identifier: string): void {
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

/**
 * The Danish CVR number (ICD 0184): 8 digits, the first not 0, whose weighted sum with
 * 2,7,6,5,4,3,2,1 is divisible by 11. Source: Erhvervsstyrelsen, "Modulus 11 kontrol";
 * Peppol BIS Billing 3 rule PEPPOL-COMMON-R042. The code list dropped the DK prefix in
 * v8.8, but BIS still accepts it and addresses written with it are in use.
 */
function validateDanishOrganizationNumber(identifier: string): void {
  const value = identifier.toUpperCase();
  if (!/^(DK)?\d{8}$/.test(value)) {
    throw new UserFacingError(
      "Danish organization number (CVR) must be 8 digits, optionally prefixed with 'DK'"
    );
  }
  const digits = value.replace(/^DK/, "");
  if (digits[0] === "0" || weightedSum(digits, [2, 7, 6, 5, 4, 3, 2, 1]) % 11 !== 0) {
    throw new UserFacingError("Danish organization number (CVR) has an invalid check digit");
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

  if (!passesMod11_10(digits)) {
    throw new UserFacingError("German VAT number has an invalid check digit");
  }
}

/** ISO/IEC 7064 MOD 11,10: whether the last digit is the check digit over the others. */
function passesMod11_10(digits: string): boolean {
  let product = 10;
  for (let index = 0; index < digits.length - 1; index++) {
    let sum = (digits.charCodeAt(index) - 48 + product) % 10;
    if (sum === 0) {
      sum = 10;
    }
    product = (2 * sum) % 11;
  }
  return (11 - product) % 10 === digits.charCodeAt(digits.length - 1) - 48;
}

/** The sum of the digits, each multiplied by the weight in the same position. */
function weightedSum(digits: string, weights: number[]): number {
  let sum = 0;
  for (let index = 0; index < weights.length; index++) {
    sum += (digits.charCodeAt(index) - 48) * weights[index]!;
  }
  return sum;
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

/**
 * A national VAT number as VIES knows it: a country prefix, the national number and,
 * where the country published how, a check over that number. Every validator below
 * names its source; a country whose check is not published is held to its format only.
 */
function vatNumberValidator({
  name,
  prefixes,
  pattern,
  format,
  check,
}: {
  /** How the messages name the number's country, e.g. "Austrian". */
  name: string;
  /** The prefixes the number starts with: its VIES country code. */
  prefixes: string[];
  /** The part after the prefix. */
  pattern: RegExp;
  /** The whole format with an example, as the message describes it. */
  format: string;
  /** The national check over the part after the prefix. */
  check?: (number: string) => boolean;
}): IdentifierValidator {
  return (identifier) => {
    const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();
    const prefix = prefixes.find((candidate) => cleaned.startsWith(candidate));
    if (!prefix) {
      throw new UserFacingError(
        `${name} VAT number must start with ${prefixes.map((candidate) => `'${candidate}'`).join(" or ")}`
      );
    }
    const number = cleaned.substring(prefix.length);
    if (!pattern.test(number)) {
      throw new UserFacingError(`${name} VAT number must have the format ${format}`);
    }
    if (check && !check(number)) {
      throw new UserFacingError(`${name} VAT number has an invalid check digit`);
    }
  };
}

/** A national business register or tax number, held to its format and, where published, its check. */
function registerNumberValidator({
  name,
  pattern,
  format,
  check,
}: {
  /** The number as the messages name it, e.g. "Norwegian organisation number". */
  name: string;
  pattern: RegExp;
  /** What the message says the number must be, with an example. */
  format: string;
  check?: (number: string) => boolean;
}): IdentifierValidator {
  return (identifier) => {
    const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();
    if (!pattern.test(cleaned)) {
      throw new UserFacingError(`${name} must be ${format}`);
    }
    if (check && !check(cleaned)) {
      throw new UserFacingError(`${name} has an invalid check digit`);
    }
  };
}

/**
 * The weighted modulo 11 check digit several registers use: 11 minus the remainder,
 * 0 for remainder 0. A result of 10 is never issued, so such a number is refused.
 */
function passesMod11CheckDigit(digits: string, weights: number[]): boolean {
  const remainder = weightedSum(digits, weights) % 11;
  const expected = remainder === 0 ? 0 : 11 - remainder;
  return expected !== 10 && expected === digits.charCodeAt(weights.length) - 48;
}

// Austria. The VAT number is ATU followed by 8 digits, the last a Luhn variant over
// the 7 before it. Source: Bundesministerium für Finanzen, "Konstruktionsregeln der
// UID" (November 2020), which publishes the rules the member states released.
const validateAustrianVatNumber = vatNumberValidator({
  name: "Austrian",
  prefixes: ["AT"],
  pattern: /^U\d{8}$/,
  format: "ATU + 8 digits (e.g. ATU37866403)",
  check: (number) => {
    const digits = [...number.substring(1)].map(Number);
    const doubled = (digit: number) => Math.floor(digit / 5) + ((2 * digit) % 10);
    const sum = digits[0]! + doubled(digits[1]!) + digits[2]! + doubled(digits[3]!) + digits[4]! + doubled(digits[5]!) + digits[6]!;
    return (10 - ((sum + 4) % 10)) % 10 === digits[7];
  },
});

// Scheme 9919 is the Kennziffer des Unternehmensregisters (KUR) in the Peppol code
// list, an R, 3 digits, a letter, 3 digits and a check character (Statistik Austria,
// URS web service schema). Austrian companies are published under it with their
// Firmenbuchnummer as well: up to 6 digits and a check letter (Bundesministerium für
// Justiz). Neither check is published, so both are held to their format.
const validateAustrianCompanyRegisterNumber = registerNumberValidator({
  name: "Austrian company register number",
  pattern: /^(FN)?\d{1,6}[A-Z]$|^R\d{3}[A-Z]\d{3}[A-Z0-9]$/,
  format: "a Firmenbuchnummer of up to 6 digits and a check letter (e.g. FN 123456a) or a business register key (KUR, e.g. R012W1121)",
});

// Bulgaria. 9 digits for a legal entity, 10 for a natural person. Bulgaria has not
// released its check digit algorithm for publication (Bundesministerium für Finanzen,
// "Konstruktionsregeln der UID"), so only the format is held.
const validateBulgarianVatNumber = vatNumberValidator({
  name: "Bulgarian",
  prefixes: ["BG"],
  pattern: /^\d{9,10}$/,
  format: "BG + 9 or 10 digits (e.g. BG831642181)",
});

// Croatia. The VAT number is HR followed by the 11 digit OIB, whose last digit is an
// ISO/IEC 7064 MOD 11,10 check digit. Source: Zakon o osobnom identifikacijskom broju
// (NN 60/08), art. 3, and Pravilnik o osobnom identifikacijskom broju (NN 1/09), art. 3.
const validateCroatianVatNumber = vatNumberValidator({
  name: "Croatian",
  prefixes: ["HR"],
  pattern: /^\d{11}$/,
  format: "HR + 11 digits (e.g. HR18683136487)",
  check: passesMod11_10,
});

// Estonia. The VAT number (KMKR) is EE followed by 9 digits whose sum with the weights
// 3,7,1 repeated is divisible by 10. Source: Bundesministerium für Finanzen,
// "Konstruktionsregeln der UID".
const validateEstonianVatNumber = vatNumberValidator({
  name: "Estonian",
  prefixes: ["EE"],
  pattern: /^\d{9}$/,
  format: "EE + 9 digits (e.g. EE100070008)",
  check: (number) => weightedSum(number, [3, 7, 1, 3, 7, 1, 3, 7, 1]) % 10 === 0,
});

// The registry code (ICD 0191) is 8 digits: 1 for companies, 7 for state and municipal
// bodies, 8 for non-profit associations, 9 for foundations. The last digit is a
// modulo 11 check with the weights 1 to 7, or 3 to 9 when that leaves 10, as the
// Peppol code list (EE:CC) specifies; the Estonian personal code uses the same check.
const validateEstonianRegistryCode = registerNumberValidator({
  name: "Estonian registry code",
  pattern: /^[1789]\d{7}$/,
  format: "8 digits starting with 1, 7, 8 or 9 (e.g. 10238429)",
  check: (number) => {
    let remainder = weightedSum(number, [1, 2, 3, 4, 5, 6, 7]) % 11;
    if (remainder === 10) {
      remainder = weightedSum(number, [3, 4, 5, 6, 7, 8, 9]) % 11;
    }
    return remainder % 10 === number.charCodeAt(7) - 48;
  },
});

// Hungary. The VAT number is HU followed by the first 8 digits of the tax number,
// whose sum with the weights 9,7,3,1 repeated is divisible by 10. Sources: Nemzeti
// Adó- és Vámhivatal, "Tájékoztató a közösségi adószámról"; Bundesministerium für
// Finanzen, "Konstruktionsregeln der UID".
const validateHungarianVatNumber = vatNumberValidator({
  name: "Hungarian",
  prefixes: ["HU"],
  pattern: /^\d{8}$/,
  format: "HU + 8 digits (e.g. HU10773381)",
  check: (number) => weightedSum(number, [9, 7, 3, 1, 9, 7, 3, 1]) % 10 === 0,
});

// Iceland. The kennitala (ICD 0196) is 10 digits; the 9th is 11 minus the sum with the
// weights 3,2,7,6,5,4,3,2 modulo 11. Source: Þjóðskrá, "Um kennitölur". Since February
// 2026 kennitölur of persons are issued without a computed check digit, and sole
// traders use theirs, so the check only holds for legal entities, whose first digit is
// 4 to 7 (the day of the month plus 40).
const validateIcelandicKennitala = registerNumberValidator({
  name: "Icelandic kennitala",
  pattern: /^\d{10}$/,
  format: "10 digits (e.g. 6503760649)",
  check: (number) => !/^[4-7]/.test(number) || passesMod11CheckDigit(number, [3, 2, 7, 6, 5, 4, 3, 2]),
});

// Ireland. 7 digits and a check letter, optionally followed by a second letter (A to I,
// or W), or the older form with a letter in second position. The check letter is the
// sum with the weights 8 to 2 (and 9 times the second letter) modulo 23, W standing for
// 0 and A to V for 1 to 22; the older form is first rearranged to 0, digits 3 to 7 and
// digit 1. Sources: Revenue, "VIES Traders Manual" 4.8, for the formats; Bundesministerium
// für Finanzen, "Konstruktionsregeln der UID", for the check.
const validateIrishVatNumber = vatNumberValidator({
  name: "Irish",
  prefixes: ["IE"],
  pattern: /^\d{7}[A-W][A-IW]?$|^\d[A-Z]\d{5}[A-W]$/,
  format: "IE + 7 digits and 1 or 2 letters, or the older form with a letter in second position (e.g. IE6388047V)",
  check: (number) => {
    const letters = "WABCDEFGHIJKLMNOPQRSTUV";
    const older = /^\d[A-Z]/.test(number);
    const digits = older ? "0" + number.substring(2, 7) + number[0] : number.substring(0, 7);
    const suffix = older ? 0 : letters.indexOf(number[8] ?? "W");
    return letters[(weightedSum(digits, [8, 7, 6, 5, 4, 3, 2]) + 9 * suffix) % 23] === number[7];
  },
});

// Italy. The codice fiscale (ICD 0210) of a legal person is 11 digits with a Luhn check
// digit, that of a natural person 16 characters ending in a check letter. Source:
// Decreto ministeriale 23 dicembre 1976, articles 6 to 10, which also allows letters in
// place of the digits of a natural person's code (omocodia).
const ITALIAN_ODD_POSITION_VALUES = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
const validateItalianCodiceFiscale = registerNumberValidator({
  name: "Italian codice fiscale",
  pattern: /^\d{11}$|^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/,
  format: "11 digits for a company, or 16 letters and digits for a person (e.g. 00484960588)",
  check: (number) => {
    if (number.length === 11) {
      return passesLuhn(number);
    }
    let sum = 0;
    for (let index = 0; index < 15; index++) {
      const character = number[index]!;
      const value = /\d/.test(character) ? Number(character) : character.charCodeAt(0) - 65;
      sum += index % 2 === 0 ? ITALIAN_ODD_POSITION_VALUES[value]! : value;
    }
    return String.fromCharCode(65 + (sum % 26)) === number[15];
  },
});

// Latvia. The unified registration number (ICD 0218) of a legal entity is 11 digits
// starting with 4, 5, 6 or 9 (Peppol code list LV:URN; the Register of Enterprises).
// The register assigns it with an algorithm it does not publish, so only the format is
// held.
const validateLatvianRegistrationNumber = registerNumberValidator({
  name: "Latvian registration number",
  pattern: /^[4569]\d{10}$/,
  format: "11 digits starting with 4, 5, 6 or 9 (e.g. 40003032949)",
});

// Norway. The organisasjonsnummer (ICD 0192) is 9 digits; the last is 11 minus the sum
// with the weights 3,2,7,6,5,4,3,2 modulo 11. Source: Brønnøysundregistrene, "About the
// organisation number"; Peppol BIS Billing 3 rule PEPPOL-COMMON-R041.
const validateNorwegianOrganisationNumber = registerNumberValidator({
  name: "Norwegian organisation number",
  pattern: /^\d{9}$/,
  format: "9 digits (e.g. 974760673)",
  check: (number) => passesMod11CheckDigit(number, [3, 2, 7, 6, 5, 4, 3, 2]),
});

// Sweden. The organisationsnummer (ICD 0007) is 10 digits, the last a check digit
// computed as for the personnummer: Luhn over the 10 digits. Sources: Lag (1974:174)
// om identitetsbeteckning för juridiska personer m.fl., § 4; Skatteverket SKV 709;
// Peppol BIS Billing 3 rule PEPPOL-COMMON-R049.
const validateSwedishOrganisationNumber = registerNumberValidator({
  name: "Swedish organisation number",
  pattern: /^\d{10}$/,
  format: "10 digits (e.g. 2021005448)",
  check: passesLuhn,
});

// Slovakia. ICD 0245 is the DIČ, the tax identification number: 10 digits, divisible
// by 11 (Peppol code list SK:DIC, issued by the Financial Directorate). It is the
// participant identifier the Slovak Peppol Authority requires.
const validateSlovakTaxIdentificationNumber = registerNumberValidator({
  name: "Slovak tax identification number (DIČ)",
  pattern: /^\d{10}$/,
  format: "10 digits (e.g. 2020372640)",
  check: (number) => Number(number) % 11 === 0,
});

// Australia. The ABN (ICD 0151) is 11 digits; with 1 subtracted from the first digit,
// the sum with the weights 10,1,3,5,...,19 is divisible by 89. Source: Australian
// Business Register, "ABN format"; Peppol BIS Billing 3 rule PEPPOL-COMMON-R050.
const validateAustralianBusinessNumber = registerNumberValidator({
  name: "Australian Business Number (ABN)",
  pattern: /^[1-9]\d{10}$/,
  format: "11 digits (e.g. 51824753556)",
  check: (number) =>
    (weightedSum(number, [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]) - 10) % 89 === 0,
});

// Finland. The VAT number is FI followed by the 8 digit Y-tunnus without its hyphen;
// the last digit is 11 minus the sum with the weights 7,9,10,5,8,4,2 modulo 11, and a
// remainder of 1 is never issued. Source: Valtioneuvoston asetus 288/2001, § 4.
const validateFinnishVatNumber = vatNumberValidator({
  name: "Finnish",
  prefixes: ["FI"],
  pattern: /^\d{8}$/,
  format: "FI + 8 digits (e.g. FI02454583)",
  check: (number) => passesMod11CheckDigit(number, [7, 9, 10, 5, 8, 4, 2]),
});

// Greece. VIES writes the prefix as EL, followed by the 9 digit AFM; EN 16931 (BR-CO-09)
// accepts GR as well, and Greek VAT numbers are often written with it. Greece has not
// published its check digit algorithm, so only the format is held.
const validateGreekVatNumber = vatNumberValidator({
  name: "Greek",
  prefixes: ["EL", "GR"],
  pattern: /^\d{9}$/,
  format: "EL + 9 digits (e.g. EL094014201)",
});

// Italy. The partita IVA (ICD 0211, written with its IT prefix) is 11 digits with a
// Luhn check digit. Source: Decreto ministeriale 23 dicembre 1976, article 9.
const validateItalianVatNumber = vatNumberValidator({
  name: "Italian",
  prefixes: ["IT"],
  pattern: /^\d{11}$/,
  format: "IT + 11 digits (e.g. IT00905811006)",
  check: passesLuhn,
});

// Latvia. LV followed by 11 digits: the registration number of a legal entity or the
// personal code of a natural person (VIES; Valsts ieņēmumu dienests). Neither check
// digit algorithm is published, so only the format is held.
const validateLatvianVatNumber = vatNumberValidator({
  name: "Latvian",
  prefixes: ["LV"],
  pattern: /^\d{11}$/,
  format: "LV + 11 digits (e.g. LV40003032949)",
});

// Poland. The NIP is 10 digits; the last is the sum with the weights 6,5,7,2,3,4,5,6,7
// modulo 11, and a remainder of 10 is never issued. Source: Ministerstwo Finansów,
// TIN information sheet published by the OECD.
const validatePolishVatNumber = vatNumberValidator({
  name: "Polish",
  prefixes: ["PL"],
  pattern: /^\d{10}$/,
  format: "PL + 10 digits (e.g. PL5260250274)",
  check: (number) => weightedSum(number, [6, 5, 7, 2, 3, 4, 5, 6, 7]) % 11 === number.charCodeAt(9) - 48,
});

// Portugal. The NIF is 9 digits and never starts with 0 (Decreto-Lei 14/2013). Its
// check digit algorithm is not published by the Autoridade Tributária, so only the
// format is held.
const validatePortugueseVatNumber = vatNumberValidator({
  name: "Portuguese",
  prefixes: ["PT"],
  pattern: /^[1-9]\d{8}$/,
  format: "PT + 9 digits (e.g. PT500697256)",
});

// Romania. The CUI is 2 to 10 digits without a leading zero; left-padded to 10, the
// last digit is the sum with the weights 7,5,3,2,1,7,5,3,2, times 10, modulo 11, with
// 10 read as 0. Source: VIES for the format; the check in ANAF's DUKIntegrator
// validation software (DECValidatorRoot.checkCUI), which ANAF does not publish as text.
const validateRomanianVatNumber = vatNumberValidator({
  name: "Romanian",
  prefixes: ["RO"],
  pattern: /^[1-9]\d{1,9}$/,
  format: "RO + 2 to 10 digits (e.g. RO14056826)",
  check: (number) => {
    const padded = number.padStart(10, "0");
    return ((weightedSum(padded, [7, 5, 3, 2, 1, 7, 5, 3, 2]) * 10) % 11) % 10 === padded.charCodeAt(9) - 48;
  },
});

// Slovenia. The tax number is 8 digits, the first not 0, the last a modulo 11 check
// digit with the weights 8 to 2; a remainder of 0 is never issued and a check of 10 is
// written 0. Source: Finančna uprava, "Vpis v davčni register in davčna številka", and
// its TIN information sheet published by the OECD.
const validateSlovenianVatNumber = vatNumberValidator({
  name: "Slovenian",
  prefixes: ["SI"],
  pattern: /^[1-9]\d{7}$/,
  format: "SI + 8 digits (e.g. SI23348887)",
  check: (number) => {
    const remainder = weightedSum(number, [8, 7, 6, 5, 4, 3, 2]) % 11;
    return remainder !== 0 && (11 - remainder) % 10 === number.charCodeAt(7) - 48;
  },
});

// Slovakia. The IČ DPH is SK followed by the 10 digit DIČ (VIES; Finančná správa), so it
// takes the DIČ's check: divisible by 11 (Peppol code list SK:DIC).
const validateSlovakVatNumber = vatNumberValidator({
  name: "Slovak",
  prefixes: ["SK"],
  pattern: /^[1-9]\d{9}$/,
  format: "SK + 10 digits (e.g. SK2020273893)",
  check: (number) => Number(number) % 11 === 0,
});

// Spain. The VAT number is ES followed by any NIF (Real Decreto 1065/2007, art. 25):
// that of a legal entity (a letter and 8 characters, Orden EHA/451/2008), a DNI (8 digits
// and a letter) or an NIE (X, Y or Z, 7 digits and a letter). The check letter of a DNI
// or NIE is the number modulo 23, with X, Y and Z read as 0, 1 and 2 (Ministerio del
// Interior). The check of a legal entity's NIF is not published by the Agencia
// Tributaria, so only its format is held.
const SPANISH_CHECK_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const validateSpanishVatNumber = vatNumberValidator({
  name: "Spanish",
  prefixes: ["ES"],
  pattern: /^[A-HJNP-SUVW]\d{7}[0-9A-J]$|^\d{8}[A-Z]$|^[XYZKLM]\d{7}[A-Z]$/,
  format: "ES + 9 characters: a letter, 7 digits and a digit or letter for a company (e.g. ESA28015865), or a DNI or NIE (e.g. ES12345678Z)",
  check: (number) => {
    if (/^\d{8}[A-Z]$/.test(number)) {
      return SPANISH_CHECK_LETTERS[Number(number.substring(0, 8)) % 23] === number[8];
    }
    if (/^[XYZ]/.test(number)) {
      return SPANISH_CHECK_LETTERS[Number("XYZ".indexOf(number[0]!) + number.substring(1, 8)) % 23] === number[8];
    }
    if (/^[KLM]/.test(number)) {
      return SPANISH_CHECK_LETTERS[Number(number.substring(1, 8)) % 23] === number[8];
    }
    return true;
  },
});

// United Kingdom. GB, or XI for Northern Ireland, followed by 9 digits, 12 for a branch
// trader, or GD or HA and 3 digits for a government department or health authority
// (VIES; HMRC, "Check a UK VAT number" API). The first 9 digits satisfy the modulus 97
// check, or for registrations since 2009 the same check offset by 55, as HMRC's own
// published code implements it (api-platform-test-user, VrnChecksum).
const validateUnitedKingdomVatNumber = vatNumberValidator({
  name: "United Kingdom",
  prefixes: ["GB", "XI"],
  pattern: /^\d{9}(\d{3})?$|^(GD|HA)\d{3}$/,
  format: "GB + 9 or 12 digits (e.g. GB660454836), or GB + GD or HA + 3 digits",
  check: (number) => {
    if (!/^\d/.test(number)) {
      return true;
    }
    const total = weightedSum(number, [8, 7, 6, 5, 4, 3, 2]) + Number(number.substring(7, 9));
    return total % 97 === 0 || (total + 55) % 97 === 0;
  },
});

const validateDanishVatNumber = vatNumberValidator({
  name: "Danish",
  prefixes: ["DK"],
  pattern: /^[1-9]\d{7}$/,
  format: "DK + the 8 digit CVR number (e.g. DK10150817)",
  // The VAT number is the CVR number, with the same check.
  check: (number) => weightedSum(number, [2, 7, 6, 5, 4, 3, 2, 1]) % 11 === 0,
});

/**
 * The national numbers of each country: its VAT number, and the number its business
 * register (for Slovakia, its tax administration) identifies a company by. A country's
 * default schemes in countries.ts take the same validators, so a number is held to one
 * rule whether it is entered on the company or registered as an identifier.
 */
const countryValidators: Record<string, CountryIdentifierValidators> = {
  "AT": {
    vatNumber: validateAustrianVatNumber,
    enterpriseNumber: validateAustrianCompanyRegisterNumber,
  },
  "AU": {
    enterpriseNumber: validateAustralianBusinessNumber,
  },
  "BE": {
    vatNumber: validateBelgianVatNumber,
    enterpriseNumber: validateBelgianEnterpriseNumber,
  },
  "BG": {
    vatNumber: validateBulgarianVatNumber,
  },
  "CY": {
    vatNumber: validateCypriotVatNumber,
  },
  "DE": {
    vatNumber: validateGermanVatNumber,
  },
  "DK": {
    vatNumber: validateDanishVatNumber,
    enterpriseNumber: validateDanishOrganizationNumber,
  },
  "EE": {
    vatNumber: validateEstonianVatNumber,
    enterpriseNumber: validateEstonianRegistryCode,
  },
  "ES": {
    vatNumber: validateSpanishVatNumber,
  },
  "FI": {
    vatNumber: validateFinnishVatNumber,
  },
  "FR": {
    vatNumber: validateFrenchVatNumber,
    enterpriseNumber: validateFrenchSiren,
  },
  "GB": {
    vatNumber: validateUnitedKingdomVatNumber,
  },
  "GR": {
    vatNumber: validateGreekVatNumber,
  },
  "HR": {
    vatNumber: validateCroatianVatNumber,
  },
  "HU": {
    vatNumber: validateHungarianVatNumber,
  },
  "IE": {
    vatNumber: validateIrishVatNumber,
  },
  "IS": {
    enterpriseNumber: validateIcelandicKennitala,
  },
  "IT": {
    vatNumber: validateItalianVatNumber,
    enterpriseNumber: validateItalianCodiceFiscale,
  },
  "LU": {
    vatNumber: validateLuxembourgVatNumber,
  },
  "LV": {
    vatNumber: validateLatvianVatNumber,
    enterpriseNumber: validateLatvianRegistrationNumber,
  },
  "NL": {
    vatNumber: validateDutchVatNumber,
    enterpriseNumber: validateDutchEnterpriseNumber,
  },
  "NO": {
    enterpriseNumber: validateNorwegianOrganisationNumber,
  },
  "PL": {
    vatNumber: validatePolishVatNumber,
  },
  "PT": {
    vatNumber: validatePortugueseVatNumber,
  },
  "RO": {
    vatNumber: validateRomanianVatNumber,
  },
  "SE": {
    enterpriseNumber: validateSwedishOrganisationNumber,
  },
  "SI": {
    vatNumber: validateSlovenianVatNumber,
  },
  "SK": {
    vatNumber: validateSlovakVatNumber,
    enterpriseNumber: validateSlovakTaxIdentificationNumber,
  },
};

const FRENCH_COMPANY_SCHEMES = ["0225", "0002", "0009"];

/**
 * The national VAT number schemes of the Peppol participant identifier code list (v9.7),
 * by the country whose VAT numbers they take. Most are no country's default here, but an
 * identifier under any of them is still a VAT number, held to that country's format and
 * to the company's own VAT number.
 */
const PEPPOL_VAT_SCHEMES: Record<string, string> = {
  "0211": "IT", "9909": "NO", "9910": "HU", "9914": "AT", "9920": "ES", "9922": "AD",
  "9923": "AL", "9924": "BA", "9925": "BE", "9926": "BG", "9927": "CH", "9928": "CY",
  "9929": "CZ", "9930": "DE", "9931": "EE", "9932": "GB", "9933": "GR", "9934": "HR",
  "9935": "IE", "9936": "LI", "9937": "LT", "9938": "LU", "9939": "LV", "9940": "MC",
  "9941": "ME", "9942": "MK", "9943": "MT", "9944": "NL", "9945": "PL", "9946": "PT",
  "9947": "RO", "9948": "RS", "9949": "SI", "9950": "SK", "9951": "SM", "9952": "TR",
  "9953": "VA", "9957": "FR", "0248": "OM",
};

/**
 * Schemes the code list removed, which the Peppol Policy for use of identifiers (4a)
 * forbids using at all, with the scheme that replaced them. 9958 has its own message.
 */
const REMOVED_SCHEMES: Record<string, string> = {
  "0213": "Finnish VAT numbers are no longer a Peppol scheme.",
  "9906": "Italian VAT numbers use scheme 0211.",
  "9955": "Swedish companies are addressed by their organisation number under scheme 0007.",
};

/**
 * Validators per Peppol participant identifier scheme (ISO/IEC 6523 ICD). A country's
 * default enterprise number scheme and every national VAT scheme take that country's
 * validators; the rest are schemes no country defaults to, or whose value is more than
 * the national number.
 */
const schemeValidators: Record<string, IdentifierValidator> = {
  ...Object.fromEntries(
    [
      ...Object.entries(PEPPOL_VAT_SCHEMES).map(([scheme, country]) => [scheme, countryValidators[country]?.vatNumber] as const),
      ...COUNTRIES.map((country) => [country.defaultEnterpriseNumberScheme, countryValidators[country.code]?.enterpriseNumber] as const),
    ].filter(([scheme, validator]) => scheme && validator)
  ),
  ...Object.fromEntries(
    Object.entries(REMOVED_SCHEMES).map(([scheme, replacement]) => [
      scheme,
      () => {
        throw new UserFacingError(
          `Scheme ${scheme} was removed from the Peppol participant identifier code list and can no longer be used. ${replacement}`
        );
      },
    ])
  ),
  "0002": validateFrenchSiren,
  "0009": validateFrenchSiret,
  // France's default scheme: an electronic address opening with the SIREN.
  "0225": validateFrenchElectronicAddress,
  "9957": validateFrenchVatNumber,
  "0204": validateLeitwegId,
  "9958": rejectDeprecatedLeitwegIdScheme,
  "0088": validateGln,
  "9918": validateIban,
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
 * Holds a company's VAT number and enterprise number against its country: the VAT
 * number has to carry the country's prefix, and both have to pass the country's
 * national rules.
 */
export function validateCompanyNumbers({
  country,
  vatNumber,
  enterpriseNumber,
  enterpriseNumberScheme,
}: {
  country?: string | null;
  vatNumber?: string | null;
  enterpriseNumber?: string | null;
  /** The scheme the company names its enterprise number under; null leaves it to the country. */
  enterpriseNumberScheme?: string | null;
}): void {
  if (vatNumber && !/^[A-Z]{2}/.test(vatNumber)) {
    throw new UserFacingError("VAT number must start with a country code (e.g. BE, NL, DE)");
  }
  if (vatNumber && country && !getVatNumberPrefixes(country).includes(vatNumber.substring(0, 2).toUpperCase())) {
    throw new UserFacingError(`VAT number country code (${vatNumber.substring(0, 2)}) does not match the selected country (${country})`);
  }
  if (!country) {
    return;
  }
  // An enterprise number under a scheme of its own, such as a GLN or the Dutch OIN, is
  // held to that scheme instead of the country's register. A French company's number is
  // its SIREN whichever French scheme it names, and 0204 is the Leitweg-ID German
  // companies used to default to, which names no register number.
  const defaultScheme = COUNTRIES.find((entry) => entry.code === country.toUpperCase())?.defaultEnterpriseNumberScheme;
  const ownScheme =
    enterpriseNumberScheme &&
    enterpriseNumberScheme !== defaultScheme &&
    enterpriseNumberScheme !== "0204" &&
    !(country.toUpperCase() === "FR" && FRENCH_COMPANY_SCHEMES.includes(enterpriseNumberScheme));
  if (enterpriseNumber && ownScheme) {
    validateIdentifier(enterpriseNumberScheme!, enterpriseNumber);
  }
  validateCountryIdentifier(country, {
    vatNumber,
    enterpriseNumber: ownScheme ? null : enterpriseNumber,
  });
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

/**
 * The prefixes a country's VAT numbers carry. VIES writes Greece as EL, which EN 16931
 * accepts besides GR, and the United Kingdom issues XI numbers to Northern Ireland
 * businesses for trade in goods with the EU besides its GB numbers.
 */
export function getVatNumberPrefixes(country: string): string[] {
  switch (country.toUpperCase()) {
    case "GR":
      return ["EL", "GR"];
    case "GB":
      return ["GB", "XI"];
    default:
      return [country.toUpperCase()];
  }
}

type NationalNumberScheme = { country: string; number: "vatNumber" | "enterpriseNumber" };

/**
 * The schemes whose identifier is a company's own national number: every country's
 * default enterprise number scheme, and every national VAT scheme of the code list.
 */
const nationalNumberSchemes: Record<string, NationalNumberScheme> = {
  ...Object.fromEntries(
    COUNTRIES.flatMap((country) =>
      country.defaultEnterpriseNumberScheme
        ? [[country.defaultEnterpriseNumberScheme, { country: country.code, number: "enterpriseNumber" }]]
        : []
    )
  ),
  ...Object.fromEntries(
    Object.entries(PEPPOL_VAT_SCHEMES).map(([scheme, country]) => [scheme, { country, number: "vatNumber" }])
  ),
};

/**
 * The prefixes a scheme's value may be written with that the published identifier goes
 * without: the code list dropped DK from CVR numbers in v8.8, so senders look a Danish
 * company up as 0184:10150817, and a Firmenbuchnummer is often written with FN.
 */
const optionalPrefixes: Record<string, RegExp> = {
  "0184": /^DK(?=\d)/i,
  "9919": /^FN(?=\d)/i,
};

/**
 * The value an identifier is stored and published under: the cleaned identifier
 * without a prefix its scheme does not carry.
 */
export function normalizeIdentifierValue(scheme: string, identifier: string): string {
  return identifier.replace(optionalPrefixes[scheme] ?? /^$/, "");
}

/** A country's name as it reads in a sentence: "the Netherlands", "Belgium". */
function countryInProse(code: string): string {
  const name = getCountryName(code);
  return ["NL", "GB", "US", "AE"].includes(code) ? `the ${name}` : name;
}

/**
 * The identifiers a company may register under a French scheme all have to name
 * the company itself: its SIREN, the SIRET of one of its establishments, or an
 * electronic address of either, all of which open with that SIREN. The form of
 * each scheme is settled by validateIdentifier before this runs.
 */
function validateFrenchIdentifierBelongsToCompany(scheme: string, identifier: string, enterpriseNumber: string | null): void {
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

/**
 * Holds an identifier against the numbers of the company that registers it. Under a
 * scheme that names a national VAT number or business register number, the identifier
 * has to be the company's own: we verify a company by those numbers, so publishing any
 * other would let it receive documents addressed to someone else.
 *
 * That includes the schemes of other countries. A company has one VAT number and one
 * enterprise number, both of its own country, so a VAT registration it holds abroad
 * cannot be checked against anything it was verified by. A company registered for VAT
 * in another country is created as a company of that country.
 *
 * Schemes that name no national number (GLN, IBAN, Leitweg-ID, ...) are left to their
 * format.
 */
export function validateIdentifierBelongsToCompany({
  scheme,
  identifier,
  company,
}: {
  scheme: string;
  identifier: string;
  /** country, when known, makes the message name a scheme of another country as such. */
  company: { enterpriseNumber: string | null; vatNumber: string | null; country?: string | null };
}): void {
  if (FRENCH_COMPANY_SCHEMES.includes(scheme)) {
    validateFrenchIdentifierBelongsToCompany(scheme, identifier, company.enterpriseNumber);
    return;
  }

  const national = nationalNumberSchemes[scheme];
  if (!national) {
    return;
  }

  const label = national.number === "vatNumber" ? "VAT number" : "enterprise number";
  // Greek VAT numbers are compared as EL whichever prefix they were written with.
  const clean = (value: string | null) => {
    const cleaned =
      national.number === "vatNumber" ? cleanVatNumber(value)?.replace(/^GR(?=\d)/, "EL") : cleanEnterpriseNumber(value);
    return cleaned ? normalizeIdentifierValue(scheme, cleaned) : null;
  };
  const companyNumber = clean(company[national.number]);

  if (!companyNumber) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} requires a company ${label} to be set.`);
  }

  const cleanedIdentifier = clean(identifier);
  if (cleanedIdentifier !== companyNumber) {
    const foreign = company.country
      ? company.country.toUpperCase() !== national.country
      : national.number === "vatNumber" && !getVatNumberPrefixes(national.country).some((prefix) => companyNumber.startsWith(prefix));
    const country = countryInProse(national.country);
    throw new UserFacingError(
      `Company identifier with scheme ${scheme} must match the company ${label}. Expected: ${companyNumber}, got: ${cleanedIdentifier}` +
        (foreign
          ? `. Scheme ${scheme} is for ${label}s from ${country}, and a company can only register its own. Register a ${label} from ${country} on a separate company in that country.`
          : "")
    );
  }
}
