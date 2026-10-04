import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Greece. VIES writes the prefix as EL, followed by the 9 digit AFM; EN 16931 (BR-CO-09)
// accepts GR as well, and Greek VAT numbers are often written with it. Greece has not
// published its check digit algorithm, so only the format is held.
export const validateGreekVatNumber = vatNumberValidator({
  name: "Greek",
  prefixes: ["EL", "GR"],
  pattern: /^\d{9}$/,
  format: "EL + 9 digits (e.g. EL094014201)",
});

export const greece: CountryIdentifierRules = {
  country: "GR",
  vatNumber: validateGreekVatNumber,
  vatPrefixes: ["EL", "GR"],
  normalizeVatNumber: (vatNumber) => vatNumber.replace(/^GR(?=\d)/, "EL"),
};
