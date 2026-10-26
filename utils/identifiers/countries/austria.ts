import { vatNumberValidator, registerNumberValidator, type CountryIdentifierRules } from "../validators";

// Austria. The VAT number is ATU followed by 8 digits, the last a Luhn variant over
// the 7 before it. Source: Bundesministerium für Finanzen, "Konstruktionsregeln der
// UID" (November 2020), which publishes the rules the member states released.
export const validateAustrianVatNumber = vatNumberValidator({
  name: "Austrian",
  prefixes: ["AT"],
  pattern: /^U\d{8}$/,
  format: "ATU + 8 digits (e.g. ATU37866403)",
  check: (number) => {
    const digits = [...number.substring(1)].map(Number);
    const doubled = (digit: number) => Math.floor(digit / 5) + ((2 * digit) % 10);
    const sum = digits[0]! + doubled(digits[1]!) + digits[2]! + doubled(digits[3]!) + digits[4]! + doubled(digits[5]!) + digits[6]!;
    return (10 - ((sum + 4) % 10)) % 10 === digits[7];
  },
});

// Scheme 9919 is the Kennziffer des Unternehmensregisters (KUR) in the Peppol code
// list, an R, 3 digits, a letter, 3 digits and a check character (Statistik Austria,
// URS web service schema). Austrian companies are published under it with their
// Firmenbuchnummer as well: up to 6 digits and a check letter (Bundesministerium für
// Justiz). Neither check is published, so both are held to their format.
export const validateAustrianCompanyRegisterNumber = registerNumberValidator({
  name: "Austrian company register number",
  pattern: /^(FN)?\d{1,6}[A-Z]$|^R\d{3}[A-Z]\d{3}[A-Z0-9]$/,
  format: "a Firmenbuchnummer of up to 6 digits and a check letter (e.g. FN 123456a) or a business register key (KUR, e.g. R012W1121)",
});

export const austria: CountryIdentifierRules = {
  country: "AT",
  vatNumber: validateAustrianVatNumber,
  enterpriseNumber: validateAustrianCompanyRegisterNumber,
  optionalPrefixes: { "9919": /^FN(?=\d)/i },
};
