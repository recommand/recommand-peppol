import { vatNumberValidator, registerNumberValidator, type CountryIdentifierRules } from "../validators";

// Latvia. LV followed by 11 digits: the registration number of a legal entity or the
// personal code of a natural person (VIES; Valsts ieņēmumu dienests). Neither check
// digit algorithm is published, so only the format is held.
export const validateLatvianVatNumber = vatNumberValidator({
  name: "Latvian",
  prefixes: ["LV"],
  pattern: /^\d{11}$/,
  format: "LV + 11 digits (e.g. LV40003032949)",
});

// Latvia. The unified registration number (ICD 0218) of a legal entity is 11 digits
// starting with 4, 5, 6 or 9 (Peppol code list LV:URN; the Register of Enterprises).
// The register assigns it with an algorithm it does not publish, so only the format is
// held.
export const validateLatvianRegistrationNumber = registerNumberValidator({
  name: "Latvian registration number",
  pattern: /^[4569]\d{10}$/,
  format: "11 digits starting with 4, 5, 6 or 9 (e.g. 40003032949)",
});

export const latvia: CountryIdentifierRules = {
  country: "LV",
  vatNumber: validateLatvianVatNumber,
  enterpriseNumber: validateLatvianRegistrationNumber,
};
