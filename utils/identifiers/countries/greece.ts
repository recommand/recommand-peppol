import { UserFacingError } from "@peppol/utils/util";
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

/**
 * Under 9933 the Greek guidance writes the AFM without its country prefix: "for
 * Greece, the Identifier is a Greek VAT number without the country prefix", for the
 * seller's and the buyer's electronic address alike (GSIS, Greek PEPPOL BIS CIUS
 * instructions, BT-34 and BT-49). The common endpoint of all Greek public buyers is
 * 9933:997001671. Participants published with the prefix exist as well, so both
 * forms are accepted; they are different addresses on the network.
 */
export function validateGreekPeppolIdentifier(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();
  if (!/^(EL|GR)?\d{9}$/.test(cleaned)) {
    throw new UserFacingError(
      "Identifier under scheme 9933 must be a Greek VAT number (AFM) of 9 digits, without or with its EL prefix (e.g. 094014201)"
    );
  }
}

export const greece: CountryIdentifierRules = {
  country: "GR",
  vatNumber: validateGreekVatNumber,
  vatPrefixes: ["EL", "GR"],
  normalizeVatNumber: (vatNumber) => vatNumber.replace(/^GR(?=\d)/, "EL"),
  schemes: {
    "9933": validateGreekPeppolIdentifier,
  },
  // A Greek company is published under its bare AFM, the form the Greek guidance
  // prescribes, whichever way the identifier is entered.
  optionalPrefixes: { "9933": /^(EL|GR)(?=\d{9}$)/i },
};
