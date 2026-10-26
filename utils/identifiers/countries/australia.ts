import { weightedSum } from "../checksums";
import { registerNumberValidator, type CountryIdentifierRules } from "../validators";

// Australia. The ABN (ICD 0151) is 11 digits; with 1 subtracted from the first digit,
// the sum with the weights 10,1,3,5,...,19 is divisible by 89. Source: Australian
// Business Register, "ABN format"; Peppol BIS Billing 3 rule PEPPOL-COMMON-R050.
export const validateAustralianBusinessNumber = registerNumberValidator({
  name: "Australian Business Number (ABN)",
  pattern: /^[1-9]\d{10}$/,
  format: "11 digits (e.g. 51824753556)",
  check: (number) =>
    (weightedSum(number, [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]) - 10) % 89 === 0,
});

export const australia: CountryIdentifierRules = {
  country: "AU",
  enterpriseNumber: validateAustralianBusinessNumber,
};
