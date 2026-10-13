import { UserFacingError } from "@peppol/utils/util";
import { namesMatch } from "@peppol/utils/names-match";
import React from "react";
import { sendEmail } from "@core/lib/email";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { NorwegianVerificationReviewNotification } from "@peppol/emails/norwegian-verification-review-notification";
import { getEnterpriseData } from "./cbe-public-search/client";
import { BronnoysundUnavailableError } from "./bronnoysund/client";
import { assessSigningAuthority, fetchSigningAuthority } from "./bronnoysund/signing-authority";
import type { Company } from "./companies";

// An identity check proves who someone is, not that they may act for the company.
// Where the company's country has a register we can read, the person who submits
// the verification form is held against it, in two places:
//
// - before the identity check (checkRepresentative), someone the register clearly
//   does not list is refused, so they do not go through an identity check for
//   nothing;
// - after the identity check succeeded (findRepresentativeReview), a case the
//   register cannot settle on its own is held for support instead of verified. The
//   identity is proven by then, so support only decides on the authority.
//
// Countries without a register check rely on the identity check alone.

type RepresentativeName = { firstName: string; lastName: string };
type CheckedCompany = Pick<Company, "id" | "teamId" | "name" | "country" | "enterpriseNumber">;

export type RepresentativeCheckDependencies = {
  getEnterpriseData: typeof getEnterpriseData;
  fetchSigningAuthority: (organisationNumber: string) => ReturnType<typeof fetchSigningAuthority>;
};

const defaultDependencies: RepresentativeCheckDependencies = {
  getEnterpriseData,
  fetchSigningAuthority: (organisationNumber) => fetchSigningAuthority(organisationNumber),
};

function requireEnterpriseNumber(company: CheckedCompany): string {
  if (!company.enterpriseNumber) {
    throw new UserFacingError("Company does not have an enterprise number. Please complete the company details first.");
  }
  return company.enterpriseNumber;
}

/**
 * The representative has to be one of the company's representatives in the
 * Crossroads Bank for Enterprises. A company for which the register lists no named
 * representative goes through on an unknown name, so the identity check still runs.
 */
async function checkBelgianRepresentative(
  company: CheckedCompany,
  name: RepresentativeName,
  dependencies: RepresentativeCheckDependencies
): Promise<RepresentativeName> {
  const enterpriseNumber = requireEnterpriseNumber(company);
  const lookupNumber = enterpriseNumber.toUpperCase().startsWith("BE") ? enterpriseNumber.slice(2) : enterpriseNumber;
  const enterpriseData = await dependencies.getEnterpriseData(lookupNumber, company.country);
  const validRepresentatives = enterpriseData.representatives.filter(
    (rep): rep is typeof rep & { firstName: string; lastName: string } => Boolean(rep.firstName && rep.lastName)
  );

  if (validRepresentatives.length === 0) {
    return { firstName: "UNKNOWN", lastName: "UNKNOWN" };
  }
  const isRepresentative = validRepresentatives.some(
    (rep) => namesMatch(rep.firstName, name.firstName) && namesMatch(rep.lastName, name.lastName)
  );
  if (!isRepresentative) {
    throw new UserFacingError(
      "The provided name does not match any representative of this company in the CBE registry. Please contact support@recommand.eu to proceed with the verification."
    );
  }
  return name;
}

/**
 * What happens when the person may only sign together with others and holds no
 * role with full rights, for example an ordinary board member where the board signs
 * jointly. "manualReview" holds the verification for support after the identity
 * check; "accept" lets the person verify the company alone, as the Belgian check
 * does for any listed representative.
 */
export type JointSignaturePolicy = "manualReview" | "accept";
export const NORWEGIAN_JOINT_SIGNATURE_POLICY = "manualReview" as JointSignaturePolicy;

type NorwegianAssessment =
  | { outcome: "accept" }
  | { outcome: "review"; finding: string }
  | { outcome: "refuse" };

/**
 * Whether the person may act for the company according to Enhetsregisteret: sign
 * alone (signatur), hold procuration (prokura), or hold a role that has full rights
 * in Altinn, as the Norwegian Peppol Authority requires of service providers
 * onboarding Norwegian end users. Throws BronnoysundUnavailableError when the
 * register cannot be reached.
 */
async function assessNorwegianRepresentative(
  organisationNumber: string,
  name: RepresentativeName,
  dependencies: RepresentativeCheckDependencies
): Promise<NorwegianAssessment> {
  const assessment = assessSigningAuthority(await dependencies.fetchSigningAuthority(organisationNumber), name);
  switch (assessment.kind) {
    case "sole":
    case "role":
      return { outcome: "accept" };
    case "joint":
      return NORWEGIAN_JOINT_SIGNATURE_POLICY === "accept"
        ? { outcome: "accept" }
        : { outcome: "review", finding: `They may only sign jointly with others (${assessment.rule}).` };
    case "undetermined":
      return { outcome: "review", finding: `Their signing authority could not be confirmed: ${assessment.reason}.` };
    case "none":
      return { outcome: "refuse" };
  }
}

function norwegianOrganisationNumber(company: CheckedCompany): string {
  return requireEnterpriseNumber(company).replace(/\D/g, "");
}

/**
 * Before the identity check, only someone the register does not list is refused.
 * A case for review goes on to the identity check and is held afterwards, and so
 * does everyone while the register cannot be reached: it is asked again then.
 */
async function checkNorwegianRepresentative(
  company: CheckedCompany,
  name: RepresentativeName,
  dependencies: RepresentativeCheckDependencies
): Promise<RepresentativeName> {
  let assessment: NorwegianAssessment;
  try {
    assessment = await assessNorwegianRepresentative(norwegianOrganisationNumber(company), name, dependencies);
  } catch (error) {
    if (error instanceof BronnoysundUnavailableError) {
      return name;
    }
    throw error;
  }
  if (assessment.outcome === "refuse") {
    throw new UserFacingError(
      "The provided name does not match anyone who can sign for this company or holds procuration in Enhetsregisteret. Please contact support@recommand.eu to proceed with the verification."
    );
  }
  return name;
}

/** After the identity check: what support has to look at, or null to verify. */
async function reviewNorwegianRepresentative(
  company: CheckedCompany,
  name: RepresentativeName,
  dependencies: RepresentativeCheckDependencies
): Promise<string | null> {
  let assessment: NorwegianAssessment;
  try {
    assessment = await assessNorwegianRepresentative(norwegianOrganisationNumber(company), name, dependencies);
  } catch (error) {
    if (error instanceof BronnoysundUnavailableError) {
      return "Enhetsregisteret could not be reached to check their signing authority.";
    }
    throw error;
  }
  if (assessment.outcome === "accept") {
    return null;
  }
  if (assessment.outcome === "refuse") {
    // They were listed when they submitted the form, or the register was unreachable.
    return "They are not listed as someone who can sign for the company or holds procuration.";
  }
  return assessment.finding;
}

type CountryRepresentativeCheck = {
  /** Resolves to the name the identity check should expect, or throws a UserFacingError. */
  beforeIdentity: (company: CheckedCompany, name: RepresentativeName, dependencies: RepresentativeCheckDependencies) => Promise<RepresentativeName>;
  afterIdentity?: (company: CheckedCompany, name: RepresentativeName, dependencies: RepresentativeCheckDependencies) => Promise<string | null>;
};

const representativeChecks: Partial<Record<string, CountryRepresentativeCheck>> = {
  BE: { beforeIdentity: checkBelgianRepresentative },
  NO: { beforeIdentity: checkNorwegianRepresentative, afterIdentity: reviewNorwegianRepresentative },
};

/**
 * Holds the representative against the company's register before the identity
 * check, when its country has a check. Resolves to the name the identity check
 * should expect.
 */
export async function checkRepresentative(
  company: CheckedCompany,
  name: RepresentativeName,
  dependencies: RepresentativeCheckDependencies = defaultDependencies
): Promise<RepresentativeName> {
  const check = representativeChecks[company.country];
  return check ? await check.beforeIdentity(company, name, dependencies) : name;
}

/**
 * After a successful identity check: why the verification has to wait for support,
 * or null when it can be verified.
 */
export async function findRepresentativeReview(
  company: CheckedCompany,
  name: RepresentativeName,
  dependencies: RepresentativeCheckDependencies = defaultDependencies
): Promise<string | null> {
  const afterIdentity = representativeChecks[company.country]?.afterIdentity;
  return afterIdentity ? await afterIdentity(company, name, dependencies) : null;
}

/** Support hears of a held verification twice: in the alert channel, and by mail to work it from. */
export async function notifySupportOfRepresentativeReview(review: {
  company: CheckedCompany;
  sessionId: string;
  representativeName: string;
  finding: string;
}): Promise<void> {
  const { company, sessionId, representativeName, finding } = review;
  const organisationNumber = company.enterpriseNumber?.replace(/\D/g, "") ?? "";
  await sendSystemAlert(
    "Norwegian Verification Needs Manual Review",
    `${representativeName} passed the identity check for ${company.name} (${company.id}, 0192:${organisationNumber}). ${finding} Session ${sessionId} is held under review; decide it with support complete-verification.`,
    "warning"
  );
  try {
    await sendEmail({
      to: "support@recommand.eu",
      subject: `Manual review: Norwegian verification of ${company.name}`,
      email: React.createElement(NorwegianVerificationReviewNotification, {
        companyName: company.name,
        companyId: company.id,
        teamId: company.teamId,
        sessionId,
        organisationNumber,
        representativeName,
        finding,
      }),
    });
  } catch (error) {
    console.error(`Failed to email support about the Norwegian verification of company ${company.id}:`, error);
  }
}
