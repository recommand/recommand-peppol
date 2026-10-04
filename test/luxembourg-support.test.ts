import { describe, expect, it, mock } from "bun:test";

// A Luxembourg company is addressed by its VAT number under 9938. Without a format
// check the scheme took any value, so a register number (RCS, e.g. B123456) could be
// published as if it were the VAT number.

import { validateCountryIdentifier, validateIdentifier } from "../utils/identifier-validation";

const validVatNumbers = ["LU15027442", "lu15027442", "LU 1502.74-42", "LU20260743"];
const invalidVatNumbers = [
  "LU15027443",    // wrong check digits
  "LU1502744",     // seven digits
  "LU150274420",   // nine digits
  "15027442",      // no prefix
  "B123456",       // an RCS number
  "BE0123456749",  // another country's number
];

describe("Luxembourg VAT number", () => {
  it("accepts a valid number, however it is written", () => {
    for (const vatNumber of validVatNumbers) {
      expect(() => validateIdentifier("9938", vatNumber)).not.toThrow();
      expect(() => validateCountryIdentifier("LU", { vatNumber })).not.toThrow();
    }
  });

  it("refuses malformed numbers and wrong check digits", () => {
    for (const vatNumber of invalidVatNumbers) {
      expect(() => validateIdentifier("9938", vatNumber)).toThrow();
      expect(() => validateCountryIdentifier("LU", { vatNumber })).toThrow();
    }
  });

  it("names what is wrong", () => {
    expect(() => validateIdentifier("9938", "B123456")).toThrow("must start with 'LU'");
    expect(() => validateIdentifier("9938", "LU1502744")).toThrow("LU + 8 digits");
    expect(() => validateIdentifier("9938", "LU15027443")).toThrow("invalid check digit");
  });
});

// The identifier module reaches the database on import, which these checks have
// no use for.
mock.module("@recommand/db", () => ({ db: {} }));
const { validateIdentifierAgainstCompany } = await import("../data/company-identifiers");

const luxembourgish = {
  smpProvider: "recommand-smp1" as const,
  enterpriseNumber: null,
  vatNumber: "LU15027442",
};
const team = { isPlayground: false, useTestNetwork: false };

describe("scheme 9938 against the company", () => {
  it("takes the company's own VAT number, however it is written", () => {
    for (const identifier of ["LU15027442", "lu15027442", "LU 1502.74-42"]) {
      expect(() => validateIdentifierAgainstCompany({
        scheme: "9938", identifier, company: luxembourgish as any, teamExtension: team,
      })).not.toThrow();
    }
  });

  it("refuses another number under 9938", () => {
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9938", identifier: "LU20260743", company: luxembourgish as any, teamExtension: team,
    })).toThrow("must match the company VAT number");
  });

  it("refuses 9938 when the company has no VAT number", () => {
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9938", identifier: "LU15027442", company: { ...luxembourgish, vatNumber: null } as any, teamExtension: team,
    })).toThrow("requires a company VAT number");
  });
});
