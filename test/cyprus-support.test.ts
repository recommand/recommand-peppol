import { describe, expect, it, mock } from "bun:test";

// Cyprus is served by the generic setup: the country's VAT scheme is 9928, the
// number behind it is the company's own, and receiving is the plain BIS Billing
// invoice and credit note every country without its own format gets.

import { validateCountryIdentifier, validateIdentifier } from "../utils/identifier-validation";
import { COUNTRIES } from "../utils/countries";
import { COUNTRIES as DIRECTORY_COUNTRIES } from "@directory/utils/countries";

const validVatNumbers = ["CY12345678L", "cy12345678l", "CY 123.456-78 L"];
const invalidVatNumbers = [
  "CY12345678",    // no check letter
  "CY1234567L",    // seven digits
  "CY123456789L",  // nine digits
  "CY1234567LL",   // two letters
  "CY1234567L8",   // letter in the wrong place
  "BE0123456749",  // another country's number
];

describe("Cypriot VAT numbers", () => {
  it("takes CY followed by 8 digits and a check letter", () => {
    for (const vatNumber of validVatNumbers) {
      expect(() => validateCountryIdentifier("CY", { vatNumber })).not.toThrow();
      expect(() => validateIdentifier("9928", vatNumber)).not.toThrow();
    }
  });

  it("refuses anything else", () => {
    for (const vatNumber of invalidVatNumbers) {
      expect(() => validateCountryIdentifier("CY", { vatNumber })).toThrow();
      expect(() => validateIdentifier("9928", vatNumber)).toThrow();
    }
  });

  it("names the country in the message", () => {
    expect(() => validateIdentifier("9928", "XY12345678L")).toThrow("must start with 'CY'");
    expect(() => validateIdentifier("9928", "CY123456789")).toThrow("CY + 8 digits + 1 letter");
  });
});

describe("Cyprus in the country catalogue", () => {
  const cyprus = DIRECTORY_COUNTRIES.find((country) => country.code === "CY");

  it("is supported and registers its VAT number under 9928", () => {
    expect(cyprus?.supportLevel).toBe("supported");
    expect(cyprus?.defaultVatScheme).toBe("9928");
    expect(cyprus?.defaultEnterpriseNumberScheme).toBeUndefined();
  });

  it("receives the generic BIS Billing invoice and credit note", () => {
    const documentTypes = COUNTRIES.find((country) => country.code === "CY")?.defaultDocumentTypes ?? [];
    const belgianDocumentTypes = COUNTRIES.find((country) => country.code === "BE")?.defaultDocumentTypes ?? [];
    expect(documentTypes).toEqual(belgianDocumentTypes);
    expect(documentTypes).toHaveLength(2);
    expect(documentTypes.map((type) => type.processId)).toEqual([
      "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
      "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
    ]);
    expect(documentTypes.map((type) => type.docTypeId.includes("Invoice"))).toEqual([true, false]);
    expect(documentTypes.map((type) => type.docTypeId.includes("CreditNote"))).toEqual([false, true]);
  });
});

// The identifier module reaches the database on import, which these checks have
// no use for.
mock.module("@recommand/db", () => ({ db: {} }));
const { validateIdentifierAgainstCompany } = await import("../data/company-identifiers");
const { planCompanyCountryChange } = await import("../data/company-country-change");

const cypriot = {
  smpProvider: "recommand-smp1" as const,
  enterpriseNumber: null,
  vatNumber: "CY12345678L",
};
const team = { isPlayground: false, useTestNetwork: false };

describe("scheme 9928 against the company", () => {
  it("takes the company's own VAT number, however it is written", () => {
    for (const identifier of validVatNumbers) {
      expect(() => validateIdentifierAgainstCompany({
        scheme: "9928", identifier, company: cypriot as any, teamExtension: team,
      })).not.toThrow();
    }
  });

  it("refuses another number under 9928", () => {
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9928", identifier: "CY87654321L", company: cypriot as any, teamExtension: team,
    })).toThrow("must match the company VAT number");
  });

  it("refuses 9928 when the company has no VAT number", () => {
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9928", identifier: "CY12345678L", company: { ...cypriot, vatNumber: null } as any, teamExtension: team,
    })).toThrow("requires a company VAT number");
  });

  it("leaves the Belgian 9925 check as it was", () => {
    const belgian = { smpProvider: "recommand-smp1" as const, enterpriseNumber: "0123456749", vatNumber: "BE0123456749" };
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9925", identifier: "BE0123456749", company: belgian as any, teamExtension: team,
    })).not.toThrow();
    expect(() => validateIdentifierAgainstCompany({
      scheme: "9925", identifier: "BE0123456756", company: belgian as any, teamExtension: team,
    })).toThrow("Company identifier with scheme 9925 must match the company VAT number");
  });
});

describe("planning a move to Cyprus", () => {
  const base = { teamExtension: team, verificationStarted: false, networkRegistered: false };
  const belgian = {
    country: "BE",
    enterpriseNumber: "0123456749",
    vatNumber: "BE0123456749",
    enterpriseNumberScheme: "0208",
    accessPointProvider: "recommand-ap1" as const,
    smpProvider: "recommand-smp1" as const,
  };

  it("gives the company its VAT number under 9928 and nothing else", () => {
    const plan = planCompanyCountryChange({
      ...base,
      oldCompany: belgian,
      newCountry: "CY",
      enterpriseNumber: null,
      vatNumber: "CY12345678L",
      identifiers: [
        { id: "en", scheme: "0208", identifier: "0123456749" },
        { id: "vat", scheme: "9925", identifier: "be0123456749" },
      ],
    });
    expect(plan.providers).toEqual({ accessPointProvider: "recommand-ap1", smpProvider: "recommand-smp1" });
    expect(plan.createIdentifiers).toEqual([{ scheme: "9928", identifier: "cy12345678l" }]);
    expect(plan.deleteIdentifierIds).toEqual(["en", "vat"]);
    expect(plan.enterpriseNumberScheme).toBeNull();
  });
});
