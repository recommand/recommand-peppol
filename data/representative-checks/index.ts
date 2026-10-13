import { getEnterpriseData } from "../cbe-public-search/client";
import { fetchSigningAuthority } from "../bronnoysund/signing-authority";
import { belgianRepresentativeCheck } from "./belgium";
import { norwegianRepresentativeCheck } from "./norway";
import type {
  CheckedCompany,
  CountryRepresentativeCheck,
  ListedRepresentative,
  ManualReview,
  RepresentativeCheckDependencies,
  RepresentativeName,
} from "./shared";

// An identity check proves who someone is, not that they may act for the company.
// Where the company's country has a register we can read, the person who submits
// the verification form is held against it:
//
// - the form offers the people the register lists (listRepresentatives);
// - before the identity check (checkRepresentative), someone the register does not
//   list is refused, so they do not go through an identity check for nothing;
// - after the identity check succeeded (findRepresentativeReview), a case the
//   register cannot settle on its own is held for support instead of verified. The
//   identity is proven by then, so support only decides on the authority.
//
// Countries without a register check rely on the identity check alone.

export type { ListedRepresentative, RepresentativeCheckDependencies } from "./shared";
export { NORWEGIAN_JOINT_SIGNATURE_POLICY, type JointSignaturePolicy } from "./norway";

const representativeChecks: Partial<Record<string, CountryRepresentativeCheck>> = {
  BE: belgianRepresentativeCheck,
  NO: norwegianRepresentativeCheck,
};

const defaultDependencies: RepresentativeCheckDependencies = {
  getEnterpriseData,
  fetchSigningAuthority: (organisationNumber) => fetchSigningAuthority(organisationNumber),
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
 * The people to offer on the verification form, or null when the company's country
 * has no register to list them from and the representative types their name. A
 * register that cannot be reached lists nobody.
 */
export async function listRepresentatives(
  company: CheckedCompany,
  dependencies: RepresentativeCheckDependencies = defaultDependencies
): Promise<{ representatives: ListedRepresentative[]; nameWithoutList: "unknown" | "typed" } | null> {
  const check = representativeChecks[company.country];
  if (!check) {
    return null;
  }
  let representatives: ListedRepresentative[] = [];
  try {
    representatives = await check.listRepresentatives(company, dependencies);
  } catch (error) {
    console.error(`Failed to list the representatives of company ${company.id}:`, error);
  }
  return { representatives, nameWithoutList: check.nameWithoutList };
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

/** Tells support about a verification held for review, the way the company's country does. */
export async function notifySupportOfRepresentativeReview(review: ManualReview): Promise<void> {
  await representativeChecks[review.company.country]?.notifySupport?.(review);
}
