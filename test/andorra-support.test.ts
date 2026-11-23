import { describe, expect, it } from "bun:test";
import { COUNTRIES } from "../utils/countries";
import {
  derivedDefaultIdentifiers,
  validateCompanyNumbers,
  validateCountryIdentifier,
  validateIdentifier,
  validateIdentifierBelongsToCompany,
} from "../utils/identifier-validation";

// An Andorran company is identified by its NRT, the tax administration's number. The
// code list's only scheme for Andorra is 9922, which takes the NRT with its AD prefix.
// The company records the NRT as its enterprise number and is published under 9922
// from there, so it has an address without a VAT number: an invoice that is not
// subject to VAT may not carry the seller's.

// Well formed examples; the first is the one python-stdnum (ad.nrt) tests with.
const validNrts = ["U132950X", "U-132950-X", "L712345A", "A700001B", "F123456Z", "d059888n"];
const invalidNrts = [
  "I706193G",    // no such kind of holder
  "L612345A",    // a company numbered outside 700000 to 799999
  "F712345A",    // a natural person numbered above 699999
  "L71234A",     // five digits
  "L7123456A",   // seven digits
  "L712345",     // no control letter
  "ADL712345A",  // written as a VAT number
];

describe("Andorra", () => {
  it("is a supported country", () => {
    expect(COUNTRIES.find((country) => country.code === "AD")?.supportLevel).toBe("supported");
  });
});

describe("Andorran NRT", () => {
  it("is accepted as enterprise number, however it is written", () => {
    for (const enterpriseNumber of validNrts) {
      expect(() => validateCountryIdentifier("AD", { enterpriseNumber }), enterpriseNumber).not.toThrow();
    }
  });

  it("is refused when malformed or outside the range of its kind", () => {
    for (const enterpriseNumber of invalidNrts) {
      expect(() => validateCountryIdentifier("AD", { enterpriseNumber }), enterpriseNumber).toThrow("Andorran NRT must be");
    }
  });

  it("carries the AD prefix as VAT number", () => {
    for (const vatNumber of ["ADL712345A", "adl712345a", "AD U-132950-X"]) {
      expect(() => validateCompanyNumbers({ country: "AD", vatNumber: vatNumber.replace(/[^a-z0-9]/gi, "").toUpperCase() }), vatNumber).not.toThrow();
      expect(() => validateIdentifier("9922", vatNumber), vatNumber).not.toThrow();
    }
    expect(() => validateCompanyNumbers({ country: "AD", vatNumber: "ADL612345A" })).toThrow("AD + the NRT");
    expect(() => validateCompanyNumbers({ country: "AD", vatNumber: "ESB12345678" })).toThrow("does not match the selected country");
  });
});

describe("scheme 9922", () => {
  it("takes the NRT with or without its prefix, as Andorran participants are published", () => {
    for (const identifier of ["ADL712345A", "L712345A", "l-712345-a"]) {
      expect(() => validateIdentifier("9922", identifier), identifier).not.toThrow();
    }
  });

  it("refuses anything else", () => {
    for (const identifier of ["AD712345", "ADL612345A", "ESB12345678", "not-a-number"]) {
      expect(() => validateIdentifier("9922", identifier), identifier).toThrow("must be an Andorran NRT");
    }
  });
});

describe("the default identifier of an Andorran company", () => {
  it("is its NRT under 9922, without a VAT number", () => {
    expect(derivedDefaultIdentifiers("AD", { enterpriseNumber: "L-712345-A", vatNumber: null })).toEqual([
      { scheme: "9922", identifier: "ADL712345A" },
    ]);
  });

  it("is the same one when the VAT number holds the NRT as well, or alone", () => {
    expect(derivedDefaultIdentifiers("AD", { enterpriseNumber: "L712345A", vatNumber: "ADL712345A" })).toEqual([
      { scheme: "9922", identifier: "ADL712345A" },
    ]);
    expect(derivedDefaultIdentifiers("AD", { enterpriseNumber: null, vatNumber: "ADL712345A" })).toEqual([
      { scheme: "9922", identifier: "ADL712345A" },
    ]);
  });

  it("is absent without a well formed NRT", () => {
    expect(derivedDefaultIdentifiers("AD", { enterpriseNumber: null, vatNumber: null })).toEqual([]);
    expect(derivedDefaultIdentifiers("AD", { enterpriseNumber: "L612345A", vatNumber: null })).toEqual([]);
  });
});

describe("scheme 9922 against the company", () => {
  const andorran = { country: "AD", enterpriseNumber: "L712345A", vatNumber: null };

  it("takes the company's own NRT, from either number", () => {
    for (const company of [andorran, { country: "AD", enterpriseNumber: null, vatNumber: "ADL712345A" }]) {
      expect(() => validateIdentifierBelongsToCompany({ scheme: "9922", identifier: "adl712345a", company })).not.toThrow();
      expect(() => validateIdentifierBelongsToCompany({ scheme: "9922", identifier: "L712345A", company })).not.toThrow();
    }
  });

  it("refuses another NRT", () => {
    expect(() => validateIdentifierBelongsToCompany({ scheme: "9922", identifier: "ADA700001B", company: andorran })).toThrow(
      "must match the company NRT. Expected: ADL712345A, got: ADA700001B"
    );
  });

  it("refuses a company without an NRT, and a company of another country", () => {
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "9922", identifier: "ADL712345A", company: { ...andorran, enterpriseNumber: null } })
    ).toThrow("requires the company enterprise number to be set to its NRT");
    expect(() =>
      validateIdentifierBelongsToCompany({
        scheme: "9922",
        identifier: "ADL712345A",
        company: { country: "BE", enterpriseNumber: "0202239951", vatNumber: "BE0202239951" },
      })
    ).toThrow("Scheme 9922 is for tax numbers (NRT) from Andorra");
  });
});
