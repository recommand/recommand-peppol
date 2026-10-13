import { UserFacingError } from "@peppol/utils/util";
import { namesMatch } from "@peppol/utils/names-match";
import { type CheckedCompany, type CountryRepresentativeCheck, type ListedRepresentative, type RepresentativeCheckDependencies, requireEnterpriseNumber } from "./shared";

// Belgium: the representatives of the company in the Crossroads Bank for Enterprises.

async function namedRepresentatives(
  company: CheckedCompany,
  dependencies: RepresentativeCheckDependencies
): Promise<ListedRepresentative[]> {
  const enterpriseNumber = requireEnterpriseNumber(company);
  const lookupNumber = enterpriseNumber.toUpperCase().startsWith("BE") ? enterpriseNumber.slice(2) : enterpriseNumber;
  const enterpriseData = await dependencies.getEnterpriseData(lookupNumber, company.country);
  return enterpriseData.representatives.flatMap((rep) =>
    rep.firstName && rep.lastName ? [{ firstName: rep.firstName, lastName: rep.lastName, function: rep.function ?? "" }] : []
  );
}

export const belgianRepresentativeCheck: CountryRepresentativeCheck = {
  /**
   * The representative has to be one of the company's representatives. A company for
   * which the register lists no named representative goes through on an unknown
   * name, so the identity check still runs.
   */
  beforeIdentity: async (company, name, dependencies) => {
    const representatives = await namedRepresentatives(company, dependencies);
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
  // The representative picks their name; a name that is not listed cannot be used.
  allowsOtherNames: false,
};
