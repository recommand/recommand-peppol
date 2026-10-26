import { passesMod11CheckDigit } from "../checksums";
import { registerNumberValidator, type CountryIdentifierRules } from "../validators";

// Norway. The organisasjonsnummer (ICD 0192) is 9 digits; the last is 11 minus the sum
// with the weights 3,2,7,6,5,4,3,2 modulo 11. Source: Brønnøysundregistrene, "About the
// organisation number"; Peppol BIS Billing 3 rule PEPPOL-COMMON-R041.
export const validateNorwegianOrganisationNumber = registerNumberValidator({
  name: "Norwegian organisation number",
  pattern: /^\d{9}$/,
  format: "9 digits (e.g. 974760673)",
  check: (number) => passesMod11CheckDigit(number, [3, 2, 7, 6, 5, 4, 3, 2]),
});

export const norway: CountryIdentifierRules = {
  country: "NO",
  enterpriseNumber: validateNorwegianOrganisationNumber,
};
