import { weightedSum } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// United Kingdom. GB, or XI for Northern Ireland, followed by 9 digits, 12 for a branch
// trader, or GD or HA and 3 digits for a government department or health authority
// (VIES; HMRC, "Check a UK VAT number" API). The first 9 digits satisfy the modulus 97
// check, or for registrations since 2009 the same check offset by 55, as HMRC's own
// published code implements it (api-platform-test-user, VrnChecksum).
export const validateUnitedKingdomVatNumber = vatNumberValidator({
  name: "United Kingdom",
  prefixes: ["GB", "XI"],
  pattern: /^\d{9}(\d{3})?$|^(GD|HA)\d{3}$/,
  format: "GB + 9 or 12 digits (e.g. GB660454836), or GB + GD or HA + 3 digits",
  check: (number) => {
    if (!/^\d/.test(number)) {
      return true;
    }
    const total = weightedSum(number, [8, 7, 6, 5, 4, 3, 2]) + Number(number.substring(7, 9));
    return total % 97 === 0 || (total + 55) % 97 === 0;
  },
});

export const unitedKingdom: CountryIdentifierRules = {
  country: "GB",
  vatNumber: validateUnitedKingdomVatNumber,
  // Northern Ireland businesses also hold an XI number for trade in goods with the EU.
  vatPrefixes: ["GB", "XI"],
};
