import { weightedSum } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Malta. The VAT number is MT followed by 8 digits, the first not 0. With the weights
// 3, 4, 6, 7, 8, 9, 10 and 1 the sum is divisible by 37. Source: python-stdnum (mt.vat),
// which VIES matches. The company number of the Malta Business Registry has no Peppol
// scheme, so Maltese companies register their VAT number.
export const validateMalteseVatNumber = vatNumberValidator({
  name: "Maltese",
  prefixes: ["MT"],
  pattern: /^[1-9]\d{7}$/,
  format: "MT + 8 digits (e.g. MT19134013)",
  check: (number) => weightedSum(number, [3, 4, 6, 7, 8, 9, 10, 1]) % 37 === 0,
});

export const malta: CountryIdentifierRules = {
  country: "MT",
  vatNumber: validateMalteseVatNumber,
};
