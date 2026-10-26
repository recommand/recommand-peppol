import { describe, expect, it, mock } from "bun:test";
import { derivedDefaultIdentifiers, validateIdentifier, validateIdentifierBelongsToCompany } from "../utils/identifier-validation";

// Finnish companies are addressed by their OVT code (0216): 0037, the Business ID
// without its hyphen and an optional suffix. The Finnish VAT number has no Peppol
// scheme of its own any more, so a company gets its OVT code by default.

// The planner shares validation with a module that connects to the database on
// import, which these checks have no use for.
mock.module("@recommand/db", () => ({ db: {} }));
const { planCompanyCountryChange } = await import("../data/company-country-change");

// Verohallinto (0245458-3) and Nokia (0112038-9); the code list's own example.
const validOvtCodes = ["003702454583", "003701120389", "003704944842TST01", "003702454583a", "0037024545831234"];
const invalidOvtCodes = [
  "02454583",           // no 0037
  "00370245458",        // a 7 digit Business ID
  "0037024545831TST01", // a 6 character suffix
  "0037-0245458-3",     // the hyphens of the written Business ID
  "003702454583_01",    // a suffix with another character
  "FI02454583",         // the VAT number
];
const verohallinto = { vatNumber: "FI02454583", enterpriseNumber: null };

describe("Finnish OVT code (0216)", () => {
  it("accepts 0037, a Business ID and an optional suffix, in either case", () => {
    for (const identifier of validOvtCodes) {
      expect(() => validateIdentifier("0216", identifier), identifier).not.toThrow();
      expect(() => validateIdentifier("0216", identifier.toLowerCase()), identifier).not.toThrow();
    }
  });

  it("refuses other shapes", () => {
    for (const identifier of invalidOvtCodes) {
      expect(() => validateIdentifier("0216", identifier), identifier).toThrow("Finnish OVT code must be 0037");
    }
  });

  it("refuses a Business ID with a wrong check digit", () => {
    expect(() => validateIdentifier("0216", "003702454584")).toThrow("invalid check digit");
  });
});

describe("an OVT code against the company", () => {
  it("takes one built from the company's Business ID, with any suffix", () => {
    for (const identifier of ["003702454583", "003702454583TST01"]) {
      expect(() => validateIdentifierBelongsToCompany({ scheme: "0216", identifier, company: verohallinto })).not.toThrow();
    }
  });

  it("finds the Business ID in the VAT number or the enterprise number", () => {
    for (const enterpriseNumber of ["0245458-3", "02454583"]) {
      expect(() =>
        validateIdentifierBelongsToCompany({ scheme: "0216", identifier: "003702454583", company: { vatNumber: null, enterpriseNumber } })
      ).not.toThrow();
    }
  });

  it("refuses another company's", () => {
    expect(() => validateIdentifierBelongsToCompany({ scheme: "0216", identifier: "003701120389", company: verohallinto })).toThrow(
      "Expected an OVT code starting with 003702454583"
    );
  });

  it("requires the company to have a Business ID", () => {
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "0216", identifier: "003702454583", company: { vatNumber: null, enterpriseNumber: "HR123" } })
    ).toThrow("requires a company VAT number or enterprise number");
  });
});

describe("Finnish company defaults", () => {
  it("give a company its OVT code, from its VAT number or else its enterprise number", () => {
    expect(derivedDefaultIdentifiers("FI", verohallinto)).toEqual([{ scheme: "0216", identifier: "003702454583" }]);
    expect(derivedDefaultIdentifiers("FI", { vatNumber: null, enterpriseNumber: "0112038-9" })).toEqual([
      { scheme: "0216", identifier: "003701120389" },
    ]);
    expect(derivedDefaultIdentifiers("FI", { vatNumber: "FI02454583", enterpriseNumber: "0245458-3" })).toEqual([
      { scheme: "0216", identifier: "003702454583" },
    ]);
  });

  it("give none without a Business ID", () => {
    expect(derivedDefaultIdentifiers("FI", { vatNumber: null, enterpriseNumber: null })).toEqual([]);
    expect(derivedDefaultIdentifiers("FI", { vatNumber: null, enterpriseNumber: "0245458-4" })).toEqual([]);
  });

  it("are only Finland's", () => {
    expect(derivedDefaultIdentifiers("BE", { vatNumber: "BE0123456749", enterpriseNumber: "0123456749" })).toEqual([]);
  });

  it("follow a company into and out of Finland", () => {
    const base = { teamExtension: { isPlayground: false, useTestNetwork: false }, verificationStarted: false, networkRegistered: false };
    const intoFinland = planCompanyCountryChange({
      ...base,
      oldCompany: {
        country: "BE", enterpriseNumber: "0123456749", vatNumber: "BE0123456749", enterpriseNumberScheme: "0208",
        accessPointProvider: "recommand-ap1", smpProvider: "recommand-smp1",
      },
      newCountry: "FI",
      enterpriseNumber: null,
      vatNumber: "FI02454583",
      identifiers: [
        { id: "en", scheme: "0208", identifier: "0123456749" },
        { id: "vat", scheme: "9925", identifier: "be0123456749" },
      ],
    });
    expect(intoFinland.createIdentifiers).toEqual([{ scheme: "0216", identifier: "003702454583" }]);
    expect(intoFinland.deleteIdentifierIds.sort()).toEqual(["en", "vat"]);

    const outOfFinland = planCompanyCountryChange({
      ...base,
      oldCompany: {
        country: "FI", enterpriseNumber: null, vatNumber: "FI02454583", enterpriseNumberScheme: null,
        accessPointProvider: "recommand-ap1", smpProvider: "recommand-smp1",
      },
      newCountry: "BE",
      enterpriseNumber: "0123456749",
      vatNumber: "BE0123456749",
      identifiers: [{ id: "ovt", scheme: "0216", identifier: "003702454583" }],
    });
    expect(outOfFinland.deleteIdentifierIds).toEqual(["ovt"]);
  });
});
