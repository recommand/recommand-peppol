import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Bulgaria. 9 digits for a legal entity, 10 for a natural person. Bulgaria has not
// released its check digit algorithm for publication (Bundesministerium für Finanzen,
// "Konstruktionsregeln der UID"), so only the format is held.
export const validateBulgarianVatNumber = vatNumberValidator({
  name: "Bulgarian",
  prefixes: ["BG"],
  pattern: /^\d{9,10}$/,
  format: "BG + 9 or 10 digits (e.g. BG831642181)",
});

export const bulgaria: CountryIdentifierRules = {
  country: "BG",
  vatNumber: validateBulgarianVatNumber,
};
