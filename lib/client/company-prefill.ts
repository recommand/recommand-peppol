import type { CompanyFormData } from "@peppol/types/company";
import { getCountrySupportLevel } from "@peppol/utils/countries";

/**
 * Details another package already knows about a team's business, offered to fill
 * in the first company during onboarding. `notice` tells the user where the values
 * came from.
 */
export type CompanyPrefill = {
  values: Partial<CompanyFormData>;
  notice?: string;
};

type CompanyPrefillSource = (teamId: string) => Promise<CompanyPrefill | null>;

let prefillSource: CompanyPrefillSource | null = null;

/** Set where onboarding takes its company details from. */
export function setCompanyPrefillSource(source: CompanyPrefillSource) {
  prefillSource = source;
}

/**
 * The details to start the first company from, or null when there are none.
 *
 * Details of a business in a country companies cannot be created in describe no
 * company the team can add: the business that pays need not be one that sends
 * documents. None of them are offered then, not even the default country, so the
 * user chooses where the company is.
 */
export async function resolveCompanyPrefill(teamId: string): Promise<CompanyPrefill | null> {
  if (!prefillSource) return null;
  try {
    const prefill = await prefillSource(teamId);
    if (prefill && getCountrySupportLevel(prefill.values.country) === "unsupported") {
      return { values: { country: undefined } };
    }
    return prefill;
  } catch (error) {
    console.error("Company prefill failed", error);
    return null;
  }
}
