import { describe, expect, it, mock } from "bun:test";

// The identifier module connects to the database on import; nothing here needs one.
mock.module("@recommand/db", () => ({ db: {} }));

const { validateIdentifier, validateCountryIdentifier, validateLeitwegId } = await import("../utils/identifier-validation");
const { COUNTRIES } = await import("../utils/countries");
const { planCompanyCountryChange } = await import("../data/company-country-change");
const { validateIdentifierAgainstCompany } = await import("../data/company-identifiers");

// German companies are addressed by their VAT number (9930). A Leitweg-ID (0204)
// addresses a public authority's invoice reception and is only ever entered
// explicitly; its predecessor 9958 is no longer allowed on the network. GLN (0088)
// and IBAN (9918) are the fallbacks the German identifier guideline names for a
// business without a VAT number.

describe("German identifier validation", () => {
  it("accepts Leitweg-IDs with valid check digits, with and without a fine address", () => {
    for (const leitwegId of ["991-33333TEST-33", "04011000-1234512345-06", "992-90009-96", "991-33333test-33"]) {
      expect(() => validateIdentifier("0204", leitwegId)).not.toThrow();
    }
  });

  it("refuses Leitweg-IDs with wrong check digits or a malformed structure", () => {
    expect(() => validateLeitwegId("04011000-1234512345-07")).toThrow(/invalid check digits/);
    for (const malformed of ["0401100012345123450", "1-33333TEST-33", "991_33333TEST_33", "991-33333TEST-3", "HRB12345"]) {
      expect(() => validateIdentifier("0204", malformed)).toThrow(/Leitweg-ID must consist of/);
    }
  });

  it("refuses the deprecated Leitweg-ID scheme 9958 whatever the value", () => {
    expect(() => validateIdentifier("9958", "991-33333TEST-33")).toThrow(/deprecated/);
  });

  it("checks the German VAT number's format and MOD 11,10 check digit", () => {
    expect(() => validateIdentifier("9930", "DE136695976")).not.toThrow();
    expect(() => validateIdentifier("9930", "de811569869")).not.toThrow();
    expect(() => validateIdentifier("9930", "DE136695977")).toThrow(/invalid check digit/);
    expect(() => validateIdentifier("9930", "136695976")).toThrow(/must start with 'DE'/);
    expect(() => validateIdentifier("9930", "DE13669597")).toThrow(/exactly 9 digits/);
    expect(() => validateCountryIdentifier("DE", { vatNumber: "DE123456789" })).toThrow(/invalid check digit/);
  });

  it("checks GLN and IBAN check digits", () => {
    expect(() => validateIdentifier("0088", "4000001000005")).not.toThrow();
    expect(() => validateIdentifier("0088", "4000001000006")).toThrow(/invalid check digit/);
    expect(() => validateIdentifier("0088", "400000100000")).toThrow(/exactly 13 digits/);
    expect(() => validateIdentifier("9918", "DE89370400440532013000")).not.toThrow();
    expect(() => validateIdentifier("9918", "de89370400440532013000")).not.toThrow();
    expect(() => validateIdentifier("9918", "DE89370400440532013001")).toThrow(/invalid check digits/);
  });
});

describe("German company defaults", () => {
  const germany = COUNTRIES.find((country) => country.code === "DE")!;

  it("register the VAT number under 9930 and never derive a Leitweg-ID from the register number", () => {
    expect(germany.defaultVatScheme).toBe("9930");
    expect(germany.defaultEnterpriseNumberScheme).toBeUndefined();
  });

  it("give a company moving to Germany only its VAT number as identifier", () => {
    const plan = planCompanyCountryChange({
      oldCompany: {
        country: "BE", enterpriseNumber: "0123456749", vatNumber: "BE0123456749", enterpriseNumberScheme: "0208",
        accessPointProvider: "recommand-ap1", smpProvider: "recommand-smp1",
      },
      newCountry: "DE",
      enterpriseNumber: "HRB12345",
      vatNumber: "DE136695976",
      identifiers: [
        { id: "en", scheme: "0208", identifier: "0123456749" },
        { id: "vat", scheme: "9925", identifier: "be0123456749" },
      ],
      teamExtension: { isPlayground: false, useTestNetwork: false },
      verificationStarted: false,
      networkRegistered: false,
    });
    expect(plan.createIdentifiers).toEqual([{ scheme: "9930", identifier: "de136695976" }]);
    expect(plan.deleteIdentifierIds.sort()).toEqual(["en", "vat"]);
    expect(plan.enterpriseNumberScheme).toBeNull();
  });

  it("let a company created with the old 0204 default move to another country", () => {
    const plan = planCompanyCountryChange({
      oldCompany: {
        country: "DE", enterpriseNumber: "HRB12345", vatNumber: "DE136695976", enterpriseNumberScheme: "0204",
        accessPointProvider: "recommand-ap1", smpProvider: "recommand-smp1",
      },
      newCountry: "BE",
      enterpriseNumber: "0123456749",
      vatNumber: "BE0123456749",
      identifiers: [
        { id: "legacy", scheme: "0204", identifier: "hrb12345" },
        { id: "vat", scheme: "9930", identifier: "de136695976" },
      ],
      teamExtension: { isPlayground: false, useTestNetwork: false },
      verificationStarted: false,
      networkRegistered: false,
    });
    expect(plan.deleteIdentifierIds.sort()).toEqual(["legacy", "vat"]);
    expect(plan.createIdentifiers.map((identifier) => identifier.scheme)).toEqual(["0208", "9925"]);
    expect(plan.enterpriseNumberScheme).toBe("0208");
  });

  it("only let a company register its own VAT number under 9930", () => {
    const company = { smpProvider: "recommand-smp1" as const, enterpriseNumber: null, vatNumber: "DE136695976" };
    const teamExtension = { isPlayground: false, useTestNetwork: false };
    expect(() => validateIdentifierAgainstCompany({ scheme: "9930", identifier: "de136695976", company, teamExtension })).not.toThrow();
    expect(() => validateIdentifierAgainstCompany({ scheme: "9930", identifier: "DE811569869", company, teamExtension })).toThrow(
      /must match the company VAT number/
    );
    expect(() => validateIdentifierAgainstCompany({ scheme: "9930", identifier: "DE136695976", company: { ...company, vatNumber: null }, teamExtension })).toThrow(
      /requires a company VAT number/
    );
  });
});
