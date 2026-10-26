import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Spain. The VAT number is ES followed by any NIF (Real Decreto 1065/2007, art. 25):
// that of a legal entity (a letter and 8 characters, Orden EHA/451/2008), a DNI (8 digits
// and a letter) or an NIE (X, Y or Z, 7 digits and a letter). The check letter of a DNI
// or NIE is the number modulo 23, with X, Y and Z read as 0, 1 and 2 (Ministerio del
// Interior). The check of a legal entity's NIF is not published by the Agencia
// Tributaria, so only its format is held.
export const SPANISH_CHECK_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

export const validateSpanishVatNumber = vatNumberValidator({
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

export const spain: CountryIdentifierRules = {
  country: "ES",
  vatNumber: validateSpanishVatNumber,
};
