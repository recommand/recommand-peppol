import { describe, expect, it, mock } from "bun:test";

// A Luxembourg company is addressed by its 11 digit matricule, the number of the
// register of legal persons, under 0240, or by its VAT number under 9938 when it has
// no matricule; 9938 also takes the matricule, as Luxembourg used to register it.
// Without a format check a scheme took any value, so a register number (RCS, e.g.
// B123456) could be published as if it were one of them.

import { defaultVatNumberIdentifier, derivedDefaultIdentifiers, enterpriseNumberIdentifierScheme, validateCountryIdentifier, validateIdentifier } from "../utils/identifier-validation";

const validVatNumbers = ["LU15027442", "lu15027442", "LU 1502.74-42", "LU20260743"];
const invalidVatNumbers = [
  "LU15027443",    // wrong check digits
  "LU1502744",     // seven digits
  "LU150274420",   // nine digits
  "15027442",      // no prefix
  "B123456",       // an RCS number
  "BE0123456749",  // another country's number
];
// Matricules Luxembourg organisations are published under in the Peppol Directory.
const validMatricules = ["20042228800", "19656100039", "2004 2228 800"];
const invalidMatricules = ["2004222880", "200422288001", "LU20042228800"];

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
    expect(() => validateIdentifier("9938", "15027442")).toThrow("or an 11 digit matricule");
  });
});

describe("Luxembourg matricule under 9938", () => {
  it("accepts 11 digits", () => {
    for (const matricule of validMatricules) {
      expect(() => validateIdentifier("9938", matricule), matricule).not.toThrow();
    }
  });

  it("refuses another length, and a matricule written as a VAT number", () => {
    for (const matricule of invalidMatricules) {
      expect(() => validateIdentifier("9938", matricule), matricule).toThrow();
    }
  });

  it("refuses a placeholder", () => {
    expect(() => validateIdentifier("9938", "00000000000")).toThrow("is a placeholder");
  });

  it("is not a VAT number of the company itself", () => {
    expect(() => validateCountryIdentifier("LU", { vatNumber: "20042228800" })).toThrow("must start with 'LU'");
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

  it("takes the company's matricule, recorded as its enterprise number, with or without a VAT number", () => {
    for (const company of [
      { ...luxembourgish, country: "LU", enterpriseNumber: "20042228800" },
      { ...luxembourgish, country: "LU", enterpriseNumber: "2004 2228 800", vatNumber: null },
    ]) {
      expect(() => validateIdentifierAgainstCompany({
        scheme: "9938", identifier: "20042228800", company: company as any, teamExtension: team,
      })).not.toThrow();
    }
  });

  it("refuses another matricule, or one the company has not recorded", () => {
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9938", identifier: "19656100039", company: { ...luxembourgish, country: "LU", enterpriseNumber: "20042228800" } as any, teamExtension: team,
    })).toThrow("must match the company enterprise number when it is a matricule");
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9938", identifier: "20042228800", company: { ...luxembourgish, country: "LU" } as any, teamExtension: team,
    })).toThrow("requires the company enterprise number to be set to that matricule");
  });

  it("refuses a matricule for a company that is not known to be in Luxembourg", () => {
    // An Australian ABN has 11 digits too.
    const australian = { smpProvider: "recommand-smp1" as const, country: "AU", enterpriseNumber: "51824753556", vatNumber: null };
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9938", identifier: "51824753556", company: australian as any, teamExtension: team,
    })).toThrow("Scheme 9938 is for VAT numbers and matricules from Luxembourg");
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9938", identifier: "20042228800", company: { ...luxembourgish, enterpriseNumber: "20042228800" } as any, teamExtension: team,
    })).toThrow("can only be a matricule for a company in Luxembourg");
  });

  it("refuses a Luxembourg VAT number for a company of another country", () => {
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9938", identifier: "LU15027442", company: { ...luxembourgish, country: "BE", vatNumber: "BE0123456749" } as any, teamExtension: team,
    })).toThrow("a company can only register its own");
  });
});

// 0240 is the register of legal persons' own scheme. It takes the matricule alone,
// so it is held to the company's matricule as 9938 is, or any company could publish
// another's under it.
describe("scheme 0240", () => {
  const withMatricule = { ...luxembourgish, country: "LU", enterpriseNumber: "20042228800" };

  it("accepts an 11 digit matricule, however it is written", () => {
    for (const matricule of validMatricules) {
      expect(() => validateIdentifier("0240", matricule), matricule).not.toThrow();
    }
  });

  it("refuses another length, a VAT number and a register number", () => {
    for (const identifier of [...invalidMatricules, "LU15027442", "B123456"]) {
      expect(() => validateIdentifier("0240", identifier), identifier).toThrow("must be an 11 digit Luxembourg matricule");
    }
  });

  it("takes the company's own matricule", () => {
    for (const identifier of ["20042228800", "2004 2228 800"]) {
      expect(() => validateIdentifierAgainstCompany({
        scheme: "0240", identifier, company: withMatricule as any, teamExtension: team,
      })).not.toThrow();
    }
  });

  it("refuses another matricule, or one the company has not recorded", () => {
    expect(() => validateIdentifierAgainstCompany({
      scheme: "0240", identifier: "19656100039", company: withMatricule as any, teamExtension: team,
    })).toThrow("must match the company enterprise number when it is a matricule");
    expect(() => validateIdentifierAgainstCompany({
      scheme: "0240", identifier: "20042228800", company: { ...luxembourgish, country: "LU" } as any, teamExtension: team,
    })).toThrow("requires the company enterprise number to be set to that matricule");
  });

  it("refuses a matricule for a company outside Luxembourg, or not known to be in it", () => {
    expect(() => validateIdentifierAgainstCompany({
      scheme: "0240", identifier: "20042228800", company: { ...withMatricule, country: "BE" } as any, teamExtension: team,
    })).toThrow("Scheme 0240 is for matricules from Luxembourg");
    expect(() => validateIdentifierAgainstCompany({
      scheme: "0240", identifier: "20042228800", company: { ...luxembourgish, enterpriseNumber: "20042228800" } as any, teamExtension: team,
    })).toThrow("can only be a matricule for a company in Luxembourg");
  });
});

// Luxembourg has no default enterprise number scheme: a company records its matricule
// or its RCS number. Luxembourg registers a new participant under its matricule with
// 0240, and under its VAT number with 9938 only when it has no matricule, so a
// matricule derives the 0240 identifier and takes the place of the VAT number.
describe("the identifier a Luxembourg matricule derives", () => {
  it("is derived from a matricule, however it is written", () => {
    for (const enterpriseNumber of ["20042228800", "2004 2228 800"]) {
      expect(derivedDefaultIdentifiers("LU", { enterpriseNumber, vatNumber: "LU15027442" })).toEqual([
        { scheme: "0240", identifier: "20042228800" },
      ]);
    }
    expect(derivedDefaultIdentifiers("LU", { enterpriseNumber: "20042228800", vatNumber: null })).toEqual([
      { scheme: "0240", identifier: "20042228800" },
    ]);
  });

  it("takes the place of the VAT number under 9938, which a company without a matricule keeps", () => {
    expect(defaultVatNumberIdentifier("LU", { enterpriseNumber: "20042228800", vatNumber: "LU15027442" })).toBeNull();
    for (const enterpriseNumber of ["B123456", null]) {
      expect(defaultVatNumberIdentifier("LU", { enterpriseNumber, vatNumber: "LU15027442" })).toEqual({
        scheme: "9938",
        identifier: "LU15027442",
      });
    }
    // Another country's VAT number stays a default whatever its enterprise number.
    expect(defaultVatNumberIdentifier("BE", { enterpriseNumber: "20042228800", vatNumber: "BE0123456749" })).toEqual({
      scheme: "9925",
      identifier: "BE0123456749",
    });
  });

  it("is not derived from an RCS number, or without an enterprise number", () => {
    expect(derivedDefaultIdentifiers("LU", { enterpriseNumber: "B123456", vatNumber: "LU15027442" })).toEqual([]);
    expect(derivedDefaultIdentifiers("LU", { enterpriseNumber: null, vatNumber: "LU15027442" })).toEqual([]);
  });

  it("is not derived for a company of another country", () => {
    expect(derivedDefaultIdentifiers("BE", { enterpriseNumber: "20042228800", vatNumber: null })).toEqual([]);
  });

  it("takes the place of 0240 named as the enterprise number scheme, which is Luxembourg's own", () => {
    expect(enterpriseNumberIdentifierScheme("LU", "0240")).toBeNull();
    expect(enterpriseNumberIdentifierScheme("LU", null)).toBeNull();
  });
});

// A company created before Luxembourg moved to 0240 holds its VAT number and its
// matricule under 9938. Both were defaults then, so a country change takes them along.
describe("a Luxembourg company changing country", () => {
  it("replaces the identifiers Luxembourg gave it, under 9938 as under 0240", async () => {
    const { planCompanyCountryChange } = await import("../data/company-country-change");
    const base = { teamExtension: { isPlayground: false, useTestNetwork: false }, verificationStarted: false, networkRegistered: false };
    const luxembourgCompany = {
      country: "LU", enterpriseNumber: "20042228800", vatNumber: "LU15027442", enterpriseNumberScheme: null,
      accessPointProvider: "recommand-ap1" as const, smpProvider: "recommand-smp1" as const,
    };
    const outOfLuxembourg = planCompanyCountryChange({
      ...base,
      oldCompany: luxembourgCompany,
      newCountry: "BE",
      enterpriseNumber: "0123456749",
      vatNumber: "BE0123456749",
      identifiers: [
        { id: "matricule", scheme: "0240", identifier: "20042228800" },
        { id: "oldMatricule", scheme: "9938", identifier: "20042228800" },
        { id: "oldVat", scheme: "9938", identifier: "lu15027442" },
      ],
    });
    expect(outOfLuxembourg.deleteIdentifierIds.sort()).toEqual(["matricule", "oldMatricule", "oldVat"]);

    const intoLuxembourg = planCompanyCountryChange({
      ...base,
      oldCompany: { ...luxembourgCompany, country: "BE", enterpriseNumber: "0123456749", vatNumber: "BE0123456749", enterpriseNumberScheme: "0208" },
      newCountry: "LU",
      enterpriseNumber: "20042228800",
      vatNumber: "LU15027442",
      identifiers: [],
    });
    expect(intoLuxembourg.createIdentifiers).toEqual([{ scheme: "0240", identifier: "20042228800" }]);
  });
});
