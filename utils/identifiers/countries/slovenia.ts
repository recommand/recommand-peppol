import { weightedSum } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Slovenia. The tax number is 8 digits, the first not 0, the last a modulo 11 check
// digit with the weights 8 to 2; a remainder of 0 is never issued and a check of 10 is
// written 0. Source: Finančna uprava, "Vpis v davčni register in davčna številka", and
// its TIN information sheet published by the OECD.
export const validateSlovenianVatNumber = vatNumberValidator({
  name: "Slovenian",
  prefixes: ["SI"],
  pattern: /^[1-9]\d{7}$/,
  format: "SI + 8 digits (e.g. SI23348887)",
  check: (number) => {
    const remainder = weightedSum(number, [8, 7, 6, 5, 4, 3, 2]) % 11;
    return remainder !== 0 && (11 - remainder) % 10 === number.charCodeAt(7) - 48;
  },
});

export const slovenia: CountryIdentifierRules = {
  country: "SI",
  vatNumber: validateSlovenianVatNumber,
};
