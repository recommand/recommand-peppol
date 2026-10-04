import { weightedSum } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Ireland. 7 digits and a check letter, optionally followed by a second letter (A to I,
// or W), or the older form with a letter in second position. The check letter is the
// sum with the weights 8 to 2 (and 9 times the second letter) modulo 23, W standing for
// 0 and A to V for 1 to 22; the older form is first rearranged to 0, digits 3 to 7 and
// digit 1. Sources: Revenue, "VIES Traders Manual" 4.8, for the formats; Bundesministerium
// für Finanzen, "Konstruktionsregeln der UID", for the check.
export const validateIrishVatNumber = vatNumberValidator({
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

export const ireland: CountryIdentifierRules = {
  country: "IE",
  vatNumber: validateIrishVatNumber,
};
