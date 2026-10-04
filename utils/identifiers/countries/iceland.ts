import { passesMod11CheckDigit } from "../checksums";
import { registerNumberValidator, type CountryIdentifierRules } from "../validators";

// Iceland. The kennitala (ICD 0196) is 10 digits; the 9th is 11 minus the sum with the
// weights 3,2,7,6,5,4,3,2 modulo 11. Source: Þjóðskrá, "Um kennitölur". Since February
// 2026 kennitölur of persons are issued without a computed check digit, and sole
// traders use theirs, so the check only holds for legal entities, whose first digit is
// 4 to 7 (the day of the month plus 40).
export const validateIcelandicKennitala = registerNumberValidator({
  name: "Icelandic kennitala",
  pattern: /^\d{10}$/,
  format: "10 digits (e.g. 6503760649)",
  check: (number) => !/^[4-7]/.test(number) || passesMod11CheckDigit(number, [3, 2, 7, 6, 5, 4, 3, 2]),
});

export const iceland: CountryIdentifierRules = {
  country: "IS",
  enterpriseNumber: validateIcelandicKennitala,
};
