import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Portugal. The NIF is 9 digits and never starts with 0 (Decreto-Lei 14/2013). Its
// check digit algorithm is not published by the Autoridade Tributária, so only the
// format is held.
export const validatePortugueseVatNumber = vatNumberValidator({
  name: "Portuguese",
  prefixes: ["PT"],
  pattern: /^[1-9]\d{8}$/,
  format: "PT + 9 digits (e.g. PT500697256)",
});

export const portugal: CountryIdentifierRules = {
  country: "PT",
  vatNumber: validatePortugueseVatNumber,
};
