import React from "react";
import { UserFacingError } from "@peppol/utils/util";
import { sendEmail } from "@core/lib/email";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { NorwegianVerificationReviewNotification } from "@peppol/emails/norwegian-verification-review-notification";
import { BronnoysundUnavailableError } from "../bronnoysund/client";
import { assessSigningAuthority, type SigningPerson } from "../bronnoysund/signing-authority";
import {
  type CheckedCompany,
  type CountryRepresentativeCheck,
  type ListedRepresentative,
  type ManualReview,
  type RepresentativeCheckDependencies,
  type RepresentativeName,
  requireEnterpriseNumber,
} from "./shared";

// Norway: who may act for the company according to Enhetsregisteret, as the Norwegian
// Peppol Authority requires of service providers onboarding Norwegian end users. The
// representative may sign alone (signatur), hold procuration (prokura), or hold a
// role that has full rights in Altinn.

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

function organisationNumber(company: CheckedCompany): string {
  return requireEnterpriseNumber(company).replace(/\D/g, "");
}

/** Throws BronnoysundUnavailableError when the register cannot be reached. */
async function assess(
  company: CheckedCompany,
  name: RepresentativeName,
  dependencies: RepresentativeCheckDependencies
): Promise<NorwegianAssessment> {
  const assessment = assessSigningAuthority(await dependencies.fetchSigningAuthority(organisationNumber(company)), name);
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

/** "Inger Lise Strøm" as first names "Inger Lise" and last name "Strøm". */
function splitName(fullName: string): RepresentativeName | null {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** Everyone the register names for signature or procuration, each once, with their roles. */
async function listSignatories(
  company: CheckedCompany,
  dependencies: RepresentativeCheckDependencies
): Promise<ListedRepresentative[]> {
  const authority = await dependencies.fetchSigningAuthority(organisationNumber(company));
  const persons: SigningPerson[] = [authority.signature, authority.procuration].flatMap((record) => [
    ...(record?.combinations ?? []).flatMap((combination) => combination.persons),
    ...(record?.possibleSignatories ?? []),
  ]);
  const byName = new Map<string, { name: string; roles: string[] }>();
  for (const person of persons) {
    const key = person.name.trim().toLowerCase();
    const entry = byName.get(key) ?? { name: person.name.trim(), roles: [] };
    const role = person.roleDescription || person.role;
    if (role && !entry.roles.includes(role)) {
      entry.roles.push(role);
    }
    byName.set(key, entry);
  }
  return [...byName.values()].flatMap(({ name, roles }) => {
    const split = splitName(name);
    return split ? [{ ...split, function: roles.join(", ") }] : [];
  });
}

async function notifySupport(review: ManualReview): Promise<void> {
  const { company, sessionId, representativeName, finding } = review;
  const number = company.enterpriseNumber?.replace(/\D/g, "") ?? "";
  await sendSystemAlert(
    "Norwegian Verification Needs Manual Review",
    `${representativeName} passed the identity check for ${company.name} (${company.id}, 0192:${number}). ${finding} Session ${sessionId} is held under review; decide it with support complete-verification.`,
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
        organisationNumber: number,
        representativeName,
        finding,
      }),
    });
  } catch (error) {
    console.error(`Failed to email support about the Norwegian verification of company ${company.id}:`, error);
  }
}

export const norwegianRepresentativeCheck: CountryRepresentativeCheck = {
  /**
   * Before the identity check, only someone the register does not list is refused.
   * A case for review goes on to the identity check and is held afterwards, and so
   * does everyone while the register cannot be reached: it is asked again then.
   */
  beforeIdentity: async (company, name, dependencies) => {
    let assessment: NorwegianAssessment;
    try {
      assessment = await assess(company, name, dependencies);
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
  },

  listRepresentatives: listSignatories,
  // Without a list (the register is unreachable or names nobody, as for a branch of
  // a foreign company) the representative types their name: the checks hold it
  // against the register, and support needs it when the session is held for review.
  nameWithoutList: "typed",

  afterIdentity: async (company, name, dependencies) => {
    let assessment: NorwegianAssessment;
    try {
      assessment = await assess(company, name, dependencies);
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
  },

  notifySupport,
};
