import { describe, expect, it, mock } from "bun:test";
import {
  assertIdentifiersAllowed,
  findUnsupportedIdentifiers,
  getCompanyIdentifierSchemeOptions,
} from "../data/company-identifier-policy";
import {
  describeUnsupportedIdentifierSchemes,
  getSupportedIdentifierSchemes,
  resolveDefaultPeppolProviders,
} from "../data/peppol-providers";

// The company's country decides which access point and SMP it is on, and the SMP
// decides which identifier schemes it registers. The French SMP takes the French
// electronic address scheme only, so a SIREN under 0002 or a SIRET under 0009 is
// refused there before anything is built on it, while the same schemes stay open
// to companies on our own SMP.

const mixed = [
  { scheme: "0002", identifier: "303265045" },
  { scheme: "0009", identifier: "30326504500011" },
  { scheme: "0225", identifier: "303265045" },
];

describe("country to provider mapping", () => {
  it("routes France through the shared French providers and everything else through ours", () => {
    expect(resolveDefaultPeppolProviders("FR")).toEqual({ accessPointProvider: "at-shared-ap-fr", smpProvider: "at-shared-smp-fr" });
    expect(resolveDefaultPeppolProviders("fr")).toEqual(resolveDefaultPeppolProviders("FR"));
    for (const country of ["BE", "NL", "DE", "DK"]) {
      expect(resolveDefaultPeppolProviders(country)).toEqual({ accessPointProvider: "recommand-ap1", smpProvider: "recommand-smp1" });
    }
  });
});

describe("identifier scheme policy", () => {
  it("restricts the French SMP to 0225 and leaves our SMP open", () => {
    expect(getSupportedIdentifierSchemes("at-shared-smp-fr")).toEqual(["0225"]);
    expect(getSupportedIdentifierSchemes("recommand-smp1")).toBeNull();
  });

  it("keeps only the electronic address out of a mixed French set", () => {
    const subject = { smpProvider: "at-shared-smp-fr" as const };
    expect(findUnsupportedIdentifiers(subject, mixed).map((i) => `${i.scheme}:${i.identifier}`)).toEqual([
      "0002:303265045",
      "0009:30326504500011",
    ]);
    expect(findUnsupportedIdentifiers({ smpProvider: "recommand-smp1" }, mixed)).toEqual([]);
  });

  it("does not restrict French numbers on another provider by country alone", () => {
    // A company that carries French numbers but is registered on our own SMP is
    // not limited by the French provider's rules.
    expect(getCompanyIdentifierSchemeOptions({ smpProvider: "recommand-smp1" })).toBeNull();
    expect(() => assertIdentifiersAllowed({ smpProvider: "recommand-smp1" }, mixed)).not.toThrow();
  });

  it("applies wherever the SMP is reached: production, test network, send-only", () => {
    expect(getCompanyIdentifierSchemeOptions({ smpProvider: "at-shared-smp-fr", isPlayground: false })).toEqual(["0225"]);
    expect(getCompanyIdentifierSchemeOptions({ smpProvider: "at-shared-smp-fr", isPlayground: true, useTestNetwork: true })).toEqual(["0225"]);
    expect(getCompanyIdentifierSchemeOptions({ smpProvider: "at-shared-smp-fr", useTestNetwork: true })).toEqual(["0225"]);
  });

  it("does not apply to a playground that only simulates the network", () => {
    expect(getCompanyIdentifierSchemeOptions({ smpProvider: "at-shared-smp-fr", isPlayground: true, useTestNetwork: false })).toBeNull();
    expect(findUnsupportedIdentifiers({ smpProvider: "at-shared-smp-fr", isPlayground: true }, mixed)).toEqual([]);
  });

  it("names the refused addresses without naming the provider", () => {
    let message = "";
    try {
      assertIdentifiersAllowed({ smpProvider: "at-shared-smp-fr" }, mixed);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("only supports identifier scheme 0225");
    expect(message).toContain("0002:303265045");
    expect(message).toContain("0009:30326504500011");
    expect(message).not.toContain("0225:303265045");
    for (const internal of ["at-shared", "arratech", "Arratech", "smp1"]) {
      expect(message).not.toContain(internal);
    }
    expect(describeUnsupportedIdentifierSchemes("at-shared-smp-fr", ["0002", "0002"])).toContain("Scheme 0002 cannot be used");
  });
});

// Creating an identifier the SMP refuses has to stop before the database or the
// SMP is touched, even for an unverified company whose registration is skipped.
let company: any;
let team: any;
const dbWrites: string[] = [];
const smpCalls: string[] = [];
mock.module("@recommand/db", () => ({
  db: {
    // Updating an identifier reads the current row first; nothing may be written.
    select: () => ({ from: () => ({ where: () => ({ then: (resolve: (rows: unknown[]) => unknown) => resolve([{ id: "ci", companyId: "c", scheme: "0225", identifier: "303265045" }]) }) }) }),
    insert: () => { dbWrites.push("insert"); throw new Error("database must not be written"); },
    update: () => { dbWrites.push("update"); throw new Error("database must not be written"); },
    delete: () => { dbWrites.push("delete"); throw new Error("database must not be written"); },
  },
}));
mock.module("@peppol/data/teams", () => ({
  getTeamExtensionAndCompanyByCompanyId: async () => ({ teamExtension: team, company }),
}));
mock.module("@peppol/data/smp-providers", () => ({
  upsertCompanyRegistration: async () => { smpCalls.push("upsert"); },
  unregisterCompanyIdentifier: async () => { smpCalls.push("unregister"); },
}));
const { createCompanyIdentifier, updateCompanyIdentifier, validateIdentifierAgainstCompany } = await import("../data/company-identifiers");

describe("identifier creation against the company's SMP", () => {
  const frenchCompany = { id: "c", smpProvider: "at-shared-smp-fr", enterpriseNumber: "303265045", vatNumber: null };

  it("refuses a SIREN or SIRET scheme on the French SMP before any write, registered or not", async () => {
    company = frenchCompany;
    team = { isPlayground: false, useTestNetwork: false, verificationRequirements: "strict" };
    for (const skipSmpRegistration of [true, false]) {
      for (const identifier of [{ scheme: "0002", identifier: "303265045" }, { scheme: "0009", identifier: "30326504500011" }]) {
        await expect(createCompanyIdentifier({
          companyIdentifier: { companyId: "c", ...identifier }, skipSmpRegistration, useTestNetwork: false,
        })).rejects.toThrow("only supports identifier scheme 0225");
        await expect(updateCompanyIdentifier({
          companyIdentifier: { id: "ci", companyId: "c", ...identifier }, skipSmpRegistration, useTestNetwork: false,
        })).rejects.toThrow("only supports identifier scheme 0225");
      }
    }
    expect(dbWrites).toEqual([]);
    expect(smpCalls).toEqual([]);
  });

  it("holds the electronic address against the company's SIREN as before", () => {
    expect(() => validateIdentifierAgainstCompany({
      scheme: "0225", identifier: "303265045", company: frenchCompany as any, teamExtension: team,
    })).not.toThrow();
    expect(() => validateIdentifierAgainstCompany({
      scheme: "0225", identifier: "123456782", company: frenchCompany as any, teamExtension: team,
    })).toThrow("must belong to the company");
  });

  it("lets a company on our SMP register French numbers under 0002 and 0009", () => {
    const belgianProvider = { ...frenchCompany, smpProvider: "recommand-smp1" };
    for (const identifier of [{ scheme: "0002", identifier: "303265045" }, { scheme: "0009", identifier: "30326504500011" }]) {
      expect(() => validateIdentifierAgainstCompany({ ...identifier, company: belgianProvider as any, teamExtension: team })).not.toThrow();
    }
  });
});
