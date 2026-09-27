import type { CompanyFormData } from "@peppol/types/company";

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

/** The details to start the first company from, or null when there are none. */
export async function resolveCompanyPrefill(teamId: string): Promise<CompanyPrefill | null> {
  if (!prefillSource) return null;
  try {
    return await prefillSource(teamId);
  } catch (error) {
    console.error("Company prefill failed", error);
    return null;
  }
}
