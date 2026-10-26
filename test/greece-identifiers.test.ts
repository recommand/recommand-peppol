import { describe, expect, it, mock } from "bun:test";
import { normalizeIdentifierValue, validateIdentifier, validateIdentifierBelongsToCompany } from "../utils/identifier-validation";
import { parsePeppolAddress } from "../utils/parsing/peppol-address";

// Under 9933 the Greek guidance writes the AFM without its EL prefix, for the seller as
// for the buyer, and the common endpoint of Greek public buyers is 9933:997001671.
// Participants published with the prefix exist as well. Both forms are valid
// addresses; a Greek company registers its bare AFM.

// The identifier module reaches the database on import, which these checks have
// no use for.
mock.module("@recommand/db", () => ({ db: {} }));
const { cleanIdentifier } = await import("../data/company-identifiers");

// National Bank of Greece; the Ministry of Digital Governance, the public-sector endpoint.
const nationalBank = { vatNumber: "EL094014201", enterpriseNumber: null, country: "GR" };

describe("scheme 9933", () => {
  it("takes the AFM without and with its prefix", () => {
    for (const identifier of ["094014201", "997001671", "EL094014201", "el094014201", "GR094014201"]) {
      expect(() => validateIdentifier("9933", identifier), identifier).not.toThrow();
    }
  });

  it("refuses other shapes", () => {
    for (const identifier of ["09401420", "0940142011", "EL0940142", "BE0202239951", "AT094014201"]) {
      expect(() => validateIdentifier("9933", identifier), identifier).toThrow(
        "must be a Greek VAT number (AFM) of 9 digits"
      );
    }
  });
});

describe("a Greek company's identifier under 9933", () => {
  it("is stored and published as the bare AFM, however it is entered", () => {
    for (const identifier of ["094014201", "EL094014201", "el 094014201", "GR094014201"]) {
      expect(normalizeIdentifierValue("9933", cleanIdentifier(identifier)), identifier).toBe("094014201");
    }
  });

  it("is the company's own AFM, in either form", () => {
    for (const identifier of ["094014201", "EL094014201", "gr094014201"]) {
      expect(() => validateIdentifierBelongsToCompany({ scheme: "9933", identifier, company: nationalBank }), identifier).not.toThrow();
    }
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "9933", identifier: "094014201", company: { ...nationalBank, vatNumber: "GR094014201" } })
    ).not.toThrow();
  });

  it("refuses another company's AFM", () => {
    expect(() => validateIdentifierBelongsToCompany({ scheme: "9933", identifier: "094019245", company: nationalBank })).toThrow(
      "must match the company VAT number. Expected: 094014201, got: 094019245"
    );
  });

  it("does not take a Greek company of unknown country for a foreign one", () => {
    const { country: _, ...withoutCountry } = nationalBank;
    let message = "";
    try {
      validateIdentifierBelongsToCompany({ scheme: "9933", identifier: "094019245", company: withoutCountry });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("must match the company VAT number");
    expect(message).not.toContain("is for VAT numbers from Greece");
  });

  it("is refused to a company of another country", () => {
    expect(() =>
      validateIdentifierBelongsToCompany({
        scheme: "9933",
        identifier: "094014201",
        company: { vatNumber: "BE0202239951", enterpriseNumber: "0202239951", country: "BE" },
      })
    ).toThrow("Scheme 9933 is for VAT numbers from Greece");
  });
});

describe("a recipient address under 9933", () => {
  it("is sent to as the caller wrote it, with or without the prefix", () => {
    expect(parsePeppolAddress("9933:997001671")).toEqual({ schemeId: "9933", identifier: "997001671" });
    expect(parsePeppolAddress("9933:el094381904")).toEqual({ schemeId: "9933", identifier: "EL094381904" });
  });
});
