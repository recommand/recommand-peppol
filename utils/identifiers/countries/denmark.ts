import { UserFacingError } from "@peppol/utils/util";
import { weightedSum } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

/**
 * The Danish CVR number (ICD 0184): 8 digits, the first not 0, whose weighted sum with
 * 2,7,6,5,4,3,2,1 is divisible by 11. Source: Erhvervsstyrelsen, "Modulus 11 kontrol";
 * Peppol BIS Billing 3 rule PEPPOL-COMMON-R042. The code list dropped the DK prefix in
 * v8.8, but BIS still accepts it and addresses written with it are in use.
 */
export function validateDanishOrganizationNumber(identifier: string): void {
  const value = identifier.toUpperCase();
  if (!/^(DK)?\d{8}$/.test(value)) {
    throw new UserFacingError(
      "Danish organization number (CVR) must be 8 digits, optionally prefixed with 'DK'"
    );
  }
  const digits = value.replace(/^DK/, "");
  if (digits[0] === "0" || weightedSum(digits, [2, 7, 6, 5, 4, 3, 2, 1]) % 11 !== 0) {
    throw new UserFacingError("Danish organization number (CVR) has an invalid check digit");
  }
}

export const validateDanishVatNumber = vatNumberValidator({
  name: "Danish",
  prefixes: ["DK"],
  pattern: /^[1-9]\d{7}$/,
  format: "DK + the 8 digit CVR number (e.g. DK10150817)",
  // The VAT number is the CVR number, with the same check.
  check: (number) => weightedSum(number, [2, 7, 6, 5, 4, 3, 2, 1]) % 11 === 0,
});

export const denmark: CountryIdentifierRules = {
  country: "DK",
  vatNumber: validateDanishVatNumber,
  enterpriseNumber: validateDanishOrganizationNumber,
  // The code list dropped the DK prefix in v8.8, so senders look a company up as 0184:10150817.
  optionalPrefixes: { "0184": /^DK(?=\d)/i },
};
