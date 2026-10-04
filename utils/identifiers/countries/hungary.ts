import { weightedSum } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Hungary. The VAT number is HU followed by the first 8 digits of the tax number,
// whose sum with the weights 9,7,3,1 repeated is divisible by 10. Sources: Nemzeti
// Adó- és Vámhivatal, "Tájékoztató a közösségi adószámról"; Bundesministerium für
// Finanzen, "Konstruktionsregeln der UID".
export const validateHungarianVatNumber = vatNumberValidator({
  name: "Hungarian",
  prefixes: ["HU"],
  pattern: /^\d{8}$/,
  format: "HU + 8 digits (e.g. HU10773381)",
  check: (number) => weightedSum(number, [9, 7, 3, 1, 9, 7, 3, 1]) % 10 === 0,
});

export const hungary: CountryIdentifierRules = {
  country: "HU",
  vatNumber: validateHungarianVatNumber,
};
