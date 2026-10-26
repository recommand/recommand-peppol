import { weightedSum } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Poland. The NIP is 10 digits; the last is the sum with the weights 6,5,7,2,3,4,5,6,7
// modulo 11, and a remainder of 10 is never issued. Source: Ministerstwo Finansów,
// TIN information sheet published by the OECD.
export const validatePolishVatNumber = vatNumberValidator({
  name: "Polish",
  prefixes: ["PL"],
  pattern: /^\d{10}$/,
  format: "PL + 10 digits (e.g. PL5260250274)",
  check: (number) => weightedSum(number, [6, 5, 7, 2, 3, 4, 5, 6, 7]) % 11 === number.charCodeAt(9) - 48,
});

export const poland: CountryIdentifierRules = {
  country: "PL",
  vatNumber: validatePolishVatNumber,
};
