import { weightedSum } from "../checksums";
import { vatNumberValidator, registerNumberValidator, type CountryIdentifierRules } from "../validators";

// Estonia. The VAT number (KMKR) is EE followed by 9 digits whose sum with the weights
// 3,7,1 repeated is divisible by 10. Source: Bundesministerium für Finanzen,
// "Konstruktionsregeln der UID".
export const validateEstonianVatNumber = vatNumberValidator({
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
export const validateEstonianRegistryCode = registerNumberValidator({
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

export const estonia: CountryIdentifierRules = {
  country: "EE",
  vatNumber: validateEstonianVatNumber,
  enterpriseNumber: validateEstonianRegistryCode,
};
