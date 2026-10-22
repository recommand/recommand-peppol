import { describe, expect, it } from "bun:test";
import { resolveDefaultPeppolProviders } from "../data/peppol-providers";
import { isVerificationEnforced, requiresCompanyVerification, shouldRegisterWithSmp } from "../utils/playground";

// The team's verification level decides whether a company has to be verified, except
// on the French production network, where the platform only takes a participant
// after its KYC and that KYC is the company verification.

describe("a company's verification requirement", () => {
  it("follows the team's level on our own SMP", () => {
    expect(requiresCompanyVerification({ verificationRequirements: "strict", smpProvider: "recommand-smp1" })).toBe(true);
    expect(requiresCompanyVerification({ verificationRequirements: "lax", smpProvider: "recommand-smp1" })).toBe(false);
    expect(requiresCompanyVerification({ verificationRequirements: "trusted", smpProvider: "recommand-smp1" })).toBe(false);
    expect(requiresCompanyVerification({ verificationRequirements: null, smpProvider: "recommand-smp1" })).toBe(false);
  });

  it("applies on the French production network whatever the team's level", () => {
    for (const verificationRequirements of ["strict", "lax", "trusted", null]) {
      expect(requiresCompanyVerification({ verificationRequirements, smpProvider: "at-shared-smp-fr" })).toBe(true);
    }
  });

  it("follows the team's level on the French test network, which skips KYC", () => {
    expect(
      requiresCompanyVerification({ verificationRequirements: "lax", smpProvider: "at-shared-smp-fr", useTestNetwork: true })
    ).toBe(false);
  });
});

describe("publishing a company on its SMP", () => {
  const recipient = { isPlayground: false, useTestNetwork: false, isSmpRecipient: true };

  it("waits for verification of a French company in a lax or trusted team", () => {
    for (const verificationRequirements of ["lax", "trusted"]) {
      expect(
        shouldRegisterWithSmp({ ...recipient, isVerified: false, verificationRequirements, smpProvider: "at-shared-smp-fr" })
      ).toBe(false);
      expect(
        shouldRegisterWithSmp({ ...recipient, isVerified: true, verificationRequirements, smpProvider: "at-shared-smp-fr" })
      ).toBe(true);
    }
  });

  it("does not wait for verification of a company in a lax team on our own SMP", () => {
    expect(
      shouldRegisterWithSmp({ ...recipient, isVerified: false, verificationRequirements: "lax", smpProvider: "recommand-smp1" })
    ).toBe(true);
  });
});

describe("the requirement as screens see it", () => {
  it("is enforced for strict teams and for French companies on the production network", () => {
    expect(isVerificationEnforced({ verificationRequirements: "strict", country: "BE", useTestNetwork: false })).toBe(true);
    expect(isVerificationEnforced({ verificationRequirements: "trusted", country: "FR", useTestNetwork: false })).toBe(true);
    expect(isVerificationEnforced({ verificationRequirements: "lax", country: "fr", useTestNetwork: false })).toBe(true);
    expect(isVerificationEnforced({ verificationRequirements: "lax", country: "BE", useTestNetwork: false })).toBe(false);
    expect(isVerificationEnforced({ verificationRequirements: "trusted", country: undefined, useTestNetwork: false })).toBe(false);
  });

  it("follows the team's level for French companies on the test network", () => {
    expect(isVerificationEnforced({ verificationRequirements: "lax", country: "FR", useTestNetwork: true })).toBe(false);
    expect(isVerificationEnforced({ verificationRequirements: "trusted", country: "FR", useTestNetwork: true })).toBe(false);
    expect(isVerificationEnforced({ verificationRequirements: "strict", country: "FR", useTestNetwork: true })).toBe(true);
  });

  // Screens only know a company's country; the server decides on the providers the
  // country resolves to. Both have to agree, or a screen calls a published company
  // unpublished or asks for a verification the server does not need.
  it("agrees with the server for every level, country and network", () => {
    for (const verificationRequirements of ["strict", "trusted", "lax", null]) {
      for (const country of ["BE", "FR", "fr", "NL", "DE", "NO"]) {
        for (const useTestNetwork of [false, true]) {
          const { smpProvider } = resolveDefaultPeppolProviders(country, { useTestNetwork });
          expect({ verificationRequirements, country, useTestNetwork, enforced: isVerificationEnforced({ verificationRequirements, country, useTestNetwork }) }).toEqual({
            verificationRequirements,
            country,
            useTestNetwork,
            enforced: requiresCompanyVerification({ verificationRequirements, smpProvider, useTestNetwork }),
          });
        }
      }
    }
  });
});
