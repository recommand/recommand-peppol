import { weightedSum } from "../checksums";
import { vatNumberValidator, registerNumberValidator, type CountryIdentifierRules } from "../validators";

// The IČO, the identification number the basic register of persons gives a company, is
// 8 digits, leading zeros included. With the weights 8 to 2 over the first seven, the
// last digit is 11 minus the remainder modulo 11, taken modulo 10: so remainder 0 gives
// 1 and remainder 1 gives 0, unlike the usual modulo 11 check.
function passesIcoCheck(number: string): boolean {
  const remainder = weightedSum(number, [8, 7, 6, 5, 4, 3, 2]) % 11;
  return (11 - remainder) % 10 === number.charCodeAt(7) - 48;
}

// Czechia. The VAT number (DIČ) is CZ followed by the company's IČO (8 digits), or for a
// natural person a birth number (9 or 10 digits) or a number the tax administration
// assigned (9 digits). Only the IČO has a published check, so the longer forms are held
// to their format. Source: daňový řád § 130.
export const validateCzechVatNumber = vatNumberValidator({
  name: "Czech",
  prefixes: ["CZ"],
  pattern: /^\d{8,10}$/,
  format: "CZ + 8, 9 or 10 digits (e.g. CZ27082440)",
  check: (number) => number.length !== 8 || passesIcoCheck(number),
});

export const validateCzechIco = registerNumberValidator({
  name: "Czech identification number (IČO)",
  pattern: /^\d{8}$/,
  format: "8 digits (e.g. 27082440)",
  check: passesIcoCheck,
});

export const czechia: CountryIdentifierRules = {
  country: "CZ",
  vatNumber: validateCzechVatNumber,
  enterpriseNumber: validateCzechIco,
};
