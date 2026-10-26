import { passesMod11_10 } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Croatia. The VAT number is HR followed by the 11 digit OIB, whose last digit is an
// ISO/IEC 7064 MOD 11,10 check digit. Source: Zakon o osobnom identifikacijskom broju
// (NN 60/08), art. 3, and Pravilnik o osobnom identifikacijskom broju (NN 1/09), art. 3.
export const validateCroatianVatNumber = vatNumberValidator({
  name: "Croatian",
  prefixes: ["HR"],
  pattern: /^\d{11}$/,
  format: "HR + 11 digits (e.g. HR18683136487)",
  check: passesMod11_10,
});

export const croatia: CountryIdentifierRules = {
  country: "HR",
  vatNumber: validateCroatianVatNumber,
};
