import { weightedSum } from "../checksums";
import { vatNumberValidator, registerNumberValidator, type CountryIdentifierRules } from "../validators";

// The modulo 11 check Lithuanian numbers share: the weights 1 to 9 repeated, or, when
// that leaves 10, the weights 3 to 9 and on from 1; a second 10 counts as 0.
function lithuanianCheckDigit(digits: string): number {
  const weights = (offset: number) => Array.from({ length: digits.length }, (_, index) => 1 + ((index + offset) % 9));
  let remainder = weightedSum(digits, weights(0)) % 11;
  if (remainder === 10) {
    remainder = weightedSum(digits, weights(2)) % 11;
  }
  return remainder % 10;
}

// Lithuania. The VAT number (PVM mokėtojo kodas) is LT followed by 9 digits, or 12 for
// later registrations: the second last digit is 1 and the last is the check digit above
// over the others. Source: python-stdnum (lt.pvm), which VIES matches.
export const validateLithuanianVatNumber = vatNumberValidator({
  name: "Lithuanian",
  prefixes: ["LT"],
  pattern: /^(\d{7}1\d|\d{10}1\d)$/,
  format: "LT + 9 or 12 digits, the second last being 1 (e.g. LT120212314)",
  check: (number) => lithuanianCheckDigit(number.slice(0, -1)) === number.charCodeAt(number.length - 1) - 48,
});

// The legal entity code (ICD 0200) is 9 digits, the last the check digit above over the
// first eight, as the Peppol code list (LT:LEC) specifies.
export const validateLithuanianLegalEntityCode = registerNumberValidator({
  name: "Lithuanian legal entity code",
  pattern: /^\d{9}$/,
  format: "9 digits (e.g. 288601650)",
  check: (number) => lithuanianCheckDigit(number.slice(0, 8)) === number.charCodeAt(8) - 48,
});

export const lithuania: CountryIdentifierRules = {
  country: "LT",
  vatNumber: validateLithuanianVatNumber,
  enterpriseNumber: validateLithuanianLegalEntityCode,
};
