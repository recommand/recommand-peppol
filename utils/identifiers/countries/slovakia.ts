import { vatNumberValidator, registerNumberValidator, type CountryIdentifierRules } from "../validators";

// Slovakia. The IČ DPH is SK followed by the 10 digit DIČ (VIES; Finančná správa), so it
// takes the DIČ's check: divisible by 11 (Peppol code list SK:DIC).
export const validateSlovakVatNumber = vatNumberValidator({
  name: "Slovak",
  prefixes: ["SK"],
  pattern: /^[1-9]\d{9}$/,
  format: "SK + 10 digits (e.g. SK2020273893)",
  check: (number) => Number(number) % 11 === 0,
});

// Slovakia. ICD 0245 is the DIČ, the tax identification number: 10 digits, divisible
// by 11 (Peppol code list SK:DIC, issued by the Financial Directorate). It is the
// participant identifier the Slovak Peppol Authority requires.
export const validateSlovakTaxIdentificationNumber = registerNumberValidator({
  name: "Slovak tax identification number (DIČ)",
  pattern: /^\d{10}$/,
  format: "10 digits (e.g. 2020372640)",
  check: (number) => Number(number) % 11 === 0,
});

export const slovakia: CountryIdentifierRules = {
  country: "SK",
  vatNumber: validateSlovakVatNumber,
  enterpriseNumber: validateSlovakTaxIdentificationNumber,
};
