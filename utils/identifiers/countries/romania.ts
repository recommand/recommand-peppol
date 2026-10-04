import { weightedSum } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Romania. The CUI is 2 to 10 digits without a leading zero; left-padded to 10, the
// last digit is the sum with the weights 7,5,3,2,1,7,5,3,2, times 10, modulo 11, with
// 10 read as 0. Source: VIES for the format; the check in ANAF's DUKIntegrator
// validation software (DECValidatorRoot.checkCUI), which ANAF does not publish as text.
export const validateRomanianVatNumber = vatNumberValidator({
  name: "Romanian",
  prefixes: ["RO"],
  pattern: /^[1-9]\d{1,9}$/,
  format: "RO + 2 to 10 digits (e.g. RO14056826)",
  check: (number) => {
    const padded = number.padStart(10, "0");
    return ((weightedSum(padded, [7, 5, 3, 2, 1, 7, 5, 3, 2]) * 10) % 11) % 10 === padded.charCodeAt(9) - 48;
  },
});

export const romania: CountryIdentifierRules = {
  country: "RO",
  vatNumber: validateRomanianVatNumber,
};
