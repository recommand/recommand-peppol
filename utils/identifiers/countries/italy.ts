import { passesLuhn } from "../checksums";
import { vatNumberValidator, registerNumberValidator, type CountryIdentifierRules } from "../validators";

// Italy. The partita IVA (ICD 0211, written with its IT prefix) is 11 digits with a
// Luhn check digit. Source: Decreto ministeriale 23 dicembre 1976, article 9.
export const validateItalianVatNumber = vatNumberValidator({
  name: "Italian",
  prefixes: ["IT"],
  pattern: /^\d{11}$/,
  format: "IT + 11 digits (e.g. IT00905811006)",
  check: passesLuhn,
});

// Italy. The codice fiscale (ICD 0210) of a legal person is 11 digits with a Luhn check
// digit, that of a natural person 16 characters ending in a check letter. Source:
// Decreto ministeriale 23 dicembre 1976, articles 6 to 10, which also allows letters in
// place of the digits of a natural person's code (omocodia).
export const ITALIAN_ODD_POSITION_VALUES = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];

export const validateItalianCodiceFiscale = registerNumberValidator({
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

export const italy: CountryIdentifierRules = {
  country: "IT",
  vatNumber: validateItalianVatNumber,
  enterpriseNumber: validateItalianCodiceFiscale,
};
