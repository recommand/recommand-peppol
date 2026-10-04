import { passesMod11CheckDigit } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Finland. The VAT number is FI followed by the 8 digit Y-tunnus without its hyphen;
// the last digit is 11 minus the sum with the weights 7,9,10,5,8,4,2 modulo 11, and a
// remainder of 1 is never issued. Source: Valtioneuvoston asetus 288/2001, § 4.
export const validateFinnishVatNumber = vatNumberValidator({
  name: "Finnish",
  prefixes: ["FI"],
  pattern: /^\d{8}$/,
  format: "FI + 8 digits (e.g. FI02454583)",
  check: (number) => passesMod11CheckDigit(number, [7, 9, 10, 5, 8, 4, 2]),
});

export const finland: CountryIdentifierRules = {
  country: "FI",
  vatNumber: validateFinnishVatNumber,
};
