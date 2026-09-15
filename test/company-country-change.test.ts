import { describe, expect, it, mock } from "bun:test";

// The planner is pure; the identifier module it shares validation with connects to
// the database on import, which a unit test has no use for.
mock.module("@recommand/db", () => ({ db: {} }));
const { COUNTRY_CHANGE_BLOCKED_MESSAGE, planCompanyCountryChange } = await import("../data/company-country-change");

// Moving a company to another country moves it to that country's providers and
// gives it that country's default identifiers. Everything the customer added is
// checked against the new country's rules, and nothing moves once a verification
// started or the company is on an SMP.

const belgian = {
  country: "BE",
  enterpriseNumber: "0123456749",
  vatNumber: "BE0123456749",
  enterpriseNumberScheme: "0208",
  accessPointProvider: "recommand-ap1" as const,
  smpProvider: "recommand-smp1" as const,
};
const french = {
  country: "FR",
  enterpriseNumber: "303265045",
  vatNumber: null,
  enterpriseNumberScheme: null,
  accessPointProvider: "at-shared-ap-fr" as const,
  smpProvider: "at-shared-smp-fr" as const,
};
const belgianDefaults = [
  { id: "en", scheme: "0208", identifier: "0123456749" },
  { id: "vat", scheme: "9925", identifier: "be0123456749" },
];
const base = { teamExtension: { isPlayground: false, useTestNetwork: false }, verificationStarted: false, networkRegistered: false };

describe("planning a country change", () => {
  it("moves a Belgian company to the French providers with the French default identifier", () => {
    const plan = planCompanyCountryChange({
      ...base, oldCompany: belgian, newCountry: "FR", enterpriseNumber: "303265045", vatNumber: null, identifiers: belgianDefaults,
    });
    expect(plan.providers).toEqual({ accessPointProvider: "at-shared-ap-fr", smpProvider: "at-shared-smp-fr" });
    expect(plan.providersChanged).toBe(true);
    expect(plan.deleteIdentifierIds).toEqual(["en", "vat"]);
    expect(plan.createIdentifiers).toEqual([{ scheme: "0225", identifier: "303265045" }]);
    expect(plan.keptIdentifiers).toEqual([]);
    expect(plan.enterpriseNumberScheme).toBe("0225");
  });

  it("moves a French company back to our providers with the Belgian defaults", () => {
    const plan = planCompanyCountryChange({
      ...base, oldCompany: french, newCountry: "BE", enterpriseNumber: "0123456749", vatNumber: "BE0123456749",
      identifiers: [{ id: "fr", scheme: "0225", identifier: "303265045" }],
    });
    expect(plan.providers).toEqual({ accessPointProvider: "recommand-ap1", smpProvider: "recommand-smp1" });
    expect(plan.deleteIdentifierIds).toEqual(["fr"]);
    expect(plan.createIdentifiers).toEqual([
      { scheme: "0208", identifier: "0123456749" },
      { scheme: "9925", identifier: "be0123456749" },
    ]);
    expect(plan.enterpriseNumberScheme).toBe("0208");
  });

  it("keeps the providers between countries served by the same ones", () => {
    const plan = planCompanyCountryChange({
      ...base, oldCompany: { ...belgian, country: "DE", enterpriseNumberScheme: "0204" }, newCountry: "BE",
      enterpriseNumber: "0123456749", vatNumber: "BE0123456749", identifiers: [],
    });
    expect(plan.providersChanged).toBe(false);
    expect(plan.createIdentifiers.map((i) => i.scheme)).toEqual(["0208", "9925"]);
  });

  it("refuses once a verification started or the company is on an SMP", () => {
    for (const blocked of [{ verificationStarted: true }, { networkRegistered: true }]) {
      expect(() => planCompanyCountryChange({
        ...base, ...blocked, oldCompany: belgian, newCountry: "FR", enterpriseNumber: "303265045", vatNumber: null, identifiers: belgianDefaults,
      })).toThrow(COUNTRY_CHANGE_BLOCKED_MESSAGE);
    }
    expect(COUNTRY_CHANGE_BLOCKED_MESSAGE).toContain("support@recommand.eu");
  });

  it("refuses added identifiers the new country's SMP would not register", () => {
    expect(() => planCompanyCountryChange({
      ...base, oldCompany: belgian, newCountry: "FR", enterpriseNumber: "303265045", vatNumber: null,
      identifiers: [...belgianDefaults, { id: "siret", scheme: "0009", identifier: "30326504500011" }],
    })).toThrow("Remove 0009:30326504500011 before changing the country to FR");
  });

  it("re-checks added identifiers against the company's new numbers", () => {
    expect(() => planCompanyCountryChange({
      ...base, oldCompany: french, newCountry: "BE", enterpriseNumber: "0123456749", vatNumber: "BE0123456749",
      identifiers: [{ id: "fr", scheme: "0225", identifier: "303265045" }, { id: "gln", scheme: "0088", identifier: "5410000000012" }],
    })).not.toThrow();
    expect(() => planCompanyCountryChange({
      ...base, oldCompany: french, newCountry: "BE", enterpriseNumber: "0123456749", vatNumber: "BE0123456749",
      identifiers: [{ id: "other", scheme: "0208", identifier: "0999999983" }],
    })).toThrow("not valid for a company in BE");
  });

  it("does not duplicate a default the customer already holds", () => {
    const plan = planCompanyCountryChange({
      ...base, oldCompany: belgian, newCountry: "FR", enterpriseNumber: "303265045", vatNumber: null,
      identifiers: [...belgianDefaults, { id: "fr", scheme: "0225", identifier: "303265045" }],
    });
    expect(plan.createIdentifiers).toEqual([]);
    expect(plan.keptIdentifiers.map((i) => i.id)).toEqual(["fr"]);
  });

  it("lets an explicit enterprise number scheme win over the country default", () => {
    const plan = planCompanyCountryChange({
      ...base, oldCompany: french, newCountry: "BE", enterpriseNumber: "0123456749", vatNumber: "BE0123456749",
      requestedEnterpriseNumberScheme: "0208", identifiers: [],
    });
    expect(plan.enterpriseNumberScheme).toBe("0208");
    const custom = planCompanyCountryChange({
      ...base, oldCompany: { ...belgian, enterpriseNumberScheme: "0088" }, newCountry: "NL", enterpriseNumber: "12345678", vatNumber: null, identifiers: [],
    });
    expect(custom.enterpriseNumberScheme).toBeUndefined();
  });

  it("leaves a simulated playground company free of the French scheme restriction", () => {
    const plan = planCompanyCountryChange({
      ...base, teamExtension: { isPlayground: true, useTestNetwork: false }, oldCompany: belgian, newCountry: "FR",
      enterpriseNumber: "303265045", vatNumber: null,
      identifiers: [{ id: "siret", scheme: "0009", identifier: "30326504500011" }],
    });
    expect(plan.keptIdentifiers.map((i) => i.id)).toEqual(["siret"]);
  });
});
