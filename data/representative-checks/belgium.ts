import { UserFacingError } from "@peppol/utils/util";
import { namesMatch } from "@peppol/utils/names-match";
import { type CheckedCompany, type CountryRepresentativeCheck, type ListedRepresentative, type RepresentativeCheckDependencies, requireEnterpriseNumber } from "./shared";

// Belgium: the representatives of the company in the Crossroads Bank for Enterprises.

// Representatives change without notice, for example when an association of
// co-owners appoints a new property manager, and a copy weeks old would offer the
// previous one and refuse the new one. An hour is long enough for the check before
// the identity check to reuse the copy the form has just read.
const REPRESENTATIVES_MAX_AGE_MS = 60 * 60 * 1000;

async function namedRepresentatives(
  company: CheckedCompany,
  dependencies: RepresentativeCheckDependencies
): Promise<ListedRepresentative[]> {
  const enterpriseNumber = requireEnterpriseNumber(company);
  const lookupNumber = enterpriseNumber.toUpperCase().startsWith("BE") ? enterpriseNumber.slice(2) : enterpriseNumber;
  const enterpriseData = await dependencies.getEnterpriseData(lookupNumber, company.country, {
    maxAgeMs: REPRESENTATIVES_MAX_AGE_MS,
  });
  return enterpriseData.representatives.flatMap((rep) =>
    rep.firstName && rep.lastName ? [{ firstName: rep.firstName, lastName: rep.lastName, function: rep.function ?? "" }] : []
  );
}

export const belgianRepresentativeCheck: CountryRepresentativeCheck = {
  /**
   * The representative has to be one of the company's representatives. A company for
   * which the register lists no named representative goes through on an unknown
   * name, so the identity check still runs. When the register cannot be read, the
   * representative is asked to try again rather than let through unchecked.
   */
  beforeIdentity: async (company, name, dependencies) => {
    let representatives: ListedRepresentative[];
    try {
      representatives = await namedRepresentatives(company, dependencies);
    } catch (error) {
      if (error instanceof UserFacingError) {
        throw error;
      }
      console.error(`Failed to read the representatives of company ${company.id} from the CBE:`, error);
      throw new UserFacingError(
        "The representatives of this company could not be read from the CBE registry. Please try again later, or contact support@recommand.eu if this persists."
      );
    }
    if (representatives.length === 0) {
      return { firstName: "UNKNOWN", lastName: "UNKNOWN" };
    }
    const isRepresentative = representatives.some(
      (rep) => namesMatch(rep.firstName, name.firstName) && namesMatch(rep.lastName, name.lastName)
    );
    if (!isRepresentative) {
      throw new UserFacingError(
        "The provided name does not match any representative of this company in the CBE registry. Please contact support@recommand.eu to proceed with the verification."
      );
    }
    return name;
  },

  listRepresentatives: namedRepresentatives,
  nameWithoutList: "unknown",
};
