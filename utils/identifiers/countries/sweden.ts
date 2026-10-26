import { passesLuhn } from "../checksums";
import { registerNumberValidator, type CountryIdentifierRules } from "../validators";

// Sweden. The organisationsnummer (ICD 0007) is 10 digits, the last a check digit
// computed as for the personnummer: Luhn over the 10 digits. Sources: Lag (1974:174)
// om identitetsbeteckning för juridiska personer m.fl., § 4; Skatteverket SKV 709;
// Peppol BIS Billing 3 rule PEPPOL-COMMON-R049.
export const validateSwedishOrganisationNumber = registerNumberValidator({
  name: "Swedish organisation number",
  pattern: /^\d{10}$/,
  format: "10 digits (e.g. 2021005448)",
  check: passesLuhn,
});

export const sweden: CountryIdentifierRules = {
  country: "SE",
  enterpriseNumber: validateSwedishOrganisationNumber,
};
