import { describe, expect, it } from "bun:test";
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
  it("is enforced for strict teams and for French companies", () => {
    expect(isVerificationEnforced({ verificationRequirements: "strict", country: "BE" })).toBe(true);
    expect(isVerificationEnforced({ verificationRequirements: "trusted", country: "FR" })).toBe(true);
    expect(isVerificationEnforced({ verificationRequirements: "lax", country: "fr" })).toBe(true);
    expect(isVerificationEnforced({ verificationRequirements: "lax", country: "BE" })).toBe(false);
    expect(isVerificationEnforced({ verificationRequirements: "trusted", country: undefined })).toBe(false);
  });
});
