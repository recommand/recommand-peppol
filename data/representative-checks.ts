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

// Before the identity check of a verification starts, the person who submitted the
// form is held against the company's register where the country has one we can
// read: an identity check proves who someone is, not that they may act for the
// company. Countries without a check here rely on the identity check alone.

type RepresentativeName = { firstName: string; lastName: string };
type CheckedCompany = Pick<Company, "id" | "teamId" | "name" | "country" | "enterpriseNumber">;

export type ManualReviewRequest = {
  company: CheckedCompany;
  organisationNumber: string;
  representativeName: string;
  finding: string;
};

export type RepresentativeCheckDependencies = {
  getEnterpriseData: typeof getEnterpriseData;
  fetchSigningAuthority: (organisationNumber: string) => ReturnType<typeof fetchSigningAuthority>;
  /** Hands a verification the register cannot settle to support. */
  requestManualReview: (request: ManualReviewRequest) => Promise<void>;
};

/** Support hears of it twice: in the alert channel, and by mail to work it from. */
async function requestManualReview(request: ManualReviewRequest): Promise<void> {
  const { company, organisationNumber, representativeName, finding } = request;
  await sendSystemAlert(
    "Norwegian Verification Needs Manual Review",
    `${representativeName} tried to verify ${company.name} (${company.id}, 0192:${organisationNumber}). ${finding} Check https://data.brreg.no/fullmakt/enheter/${organisationNumber}/signatur and decide the verification by hand.`,
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
        organisationNumber,
        representativeName,
        finding,
      }),
    });
  } catch (error) {
    console.error(`Failed to email support about the Norwegian verification of company ${company.id}:`, error);
  }
}

const defaultDependencies: RepresentativeCheckDependencies = {
  getEnterpriseData,
  fetchSigningAuthority: (organisationNumber) => fetchSigningAuthority(organisationNumber),
  requestManualReview,
};

/** Resolves to the name the identity check should expect, or throws a UserFacingError. */
type RepresentativeCheck = (
  company: CheckedCompany,
  name: RepresentativeName,
  dependencies: RepresentativeCheckDependencies
) => Promise<RepresentativeName>;

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
const checkBelgianRepresentative: RepresentativeCheck = async (company, name, dependencies) => {
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
};

/**
 * What happens when the person may only sign together with others, for example
 * when the board signs jointly. "manualReview" stops the automatic verification
 * and sends the company to support, who check that the others agree; "accept" lets
 * the person verify the company alone, as the Belgian check does for any listed
 * representative.
 */
export type JointSignaturePolicy = "manualReview" | "accept";
export const NORWEGIAN_JOINT_SIGNATURE_POLICY = "manualReview" as JointSignaturePolicy;

const NORWEGIAN_MANUAL_REVIEW_MESSAGE =
  "We could not confirm automatically that you may sign for this company on your own. Please contact support@recommand.eu to complete the verification.";

/**
 * The person has to be able to sign for the company according to Enhetsregisteret:
 * hold signature (signatur) or procuration (prokura), as the Norwegian Peppol
 * Authority requires of service providers onboarding Norwegian end users.
 */
const checkNorwegianSignatory: RepresentativeCheck = async (company, name, dependencies) => {
  const organisationNumber = requireEnterpriseNumber(company).replace(/\D/g, "");
  let assessment: ReturnType<typeof assessSigningAuthority>;
  try {
    assessment = assessSigningAuthority(await dependencies.fetchSigningAuthority(organisationNumber), name);
  } catch (error) {
    if (error instanceof BronnoysundUnavailableError) {
      throw new UserFacingError(
        "We could not reach Enhetsregisteret to check who can sign for this company. Please try again in a few minutes."
      );
    }
    throw error;
  }

  if (assessment.kind === "sole") {
    return name;
  }
  if (assessment.kind === "joint" && NORWEGIAN_JOINT_SIGNATURE_POLICY === "accept") {
    return name;
  }
  if (assessment.kind === "none") {
    throw new UserFacingError(
      "The provided name does not match anyone who can sign for this company or holds procuration in Enhetsregisteret. Please contact support@recommand.eu to proceed with the verification."
    );
  }

  const finding = assessment.kind === "joint"
    ? `They may only sign jointly with others (${assessment.rule}).`
    : `Their signing authority could not be confirmed: ${assessment.reason}.`;
  await dependencies.requestManualReview({
    company,
    organisationNumber,
    representativeName: `${name.firstName} ${name.lastName}`,
    finding,
  });
  throw new UserFacingError(NORWEGIAN_MANUAL_REVIEW_MESSAGE);
};

const representativeChecks: Partial<Record<string, RepresentativeCheck>> = {
  BE: checkBelgianRepresentative,
  NO: checkNorwegianSignatory,
};

/**
 * Holds the representative against the company's register when its country has a
 * check. Resolves to the name the identity check should expect.
 */
export async function checkRepresentative(
  company: CheckedCompany,
  name: RepresentativeName,
  dependencies: RepresentativeCheckDependencies = defaultDependencies
): Promise<RepresentativeName> {
  const check = representativeChecks[company.country];
  return check ? await check(company, name, dependencies) : name;
}
