import { UserFacingError } from "@peppol/utils/util";
import type { getEnterpriseData } from "../cbe-public-search/client";
import type { fetchSigningAuthority } from "../bronnoysund/signing-authority";
import type { Company } from "../companies";

export type RepresentativeName = { firstName: string; lastName: string };

export type CheckedCompany = Pick<Company, "id" | "teamId" | "name" | "country" | "enterpriseNumber">;

/** Someone the register lists for the company, offered on the verification form. */
export type ListedRepresentative = RepresentativeName & {
  /** The role, as the register describes it. */
  function: string;
};

export type RepresentativeCheckDependencies = {
  getEnterpriseData: typeof getEnterpriseData;
  fetchSigningAuthority: (organisationNumber: string) => ReturnType<typeof fetchSigningAuthority>;
};

export type ManualReview = {
  company: CheckedCompany;
  sessionId: string;
  representativeName: string;
  finding: string;
};

/** How a country checks who may act for a company. */
export type CountryRepresentativeCheck = {
  /** Before the identity check: resolves to the name the identity check should expect, or throws a UserFacingError. */
  beforeIdentity: (company: CheckedCompany, name: RepresentativeName, dependencies: RepresentativeCheckDependencies) => Promise<RepresentativeName>;
  /** The people to offer on the verification form. */
  listRepresentatives: (company: CheckedCompany, dependencies: RepresentativeCheckDependencies) => Promise<ListedRepresentative[]>;
  /** Whether the representative may type a name that is not on the list. */
  allowsOtherNames: boolean;
  /** After a successful identity check: why support has to decide, or null to verify. */
  afterIdentity?: (company: CheckedCompany, name: RepresentativeName, dependencies: RepresentativeCheckDependencies) => Promise<string | null>;
  /** Tells support about a session afterIdentity held. */
  notifySupport?: (review: ManualReview) => Promise<void>;
};

export function requireEnterpriseNumber(company: CheckedCompany): string {
  if (!company.enterpriseNumber) {
    throw new UserFacingError("Company does not have an enterprise number. Please complete the company details first.");
  }
  return company.enterpriseNumber;
}
