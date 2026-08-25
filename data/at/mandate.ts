import type { Company } from "@peppol/data/companies";
import type { CompanyIdentifier } from "@peppol/data/company-identifiers";
import { renderTailwindTemplate } from "@peppol/utils/tailwind-pdf";
import { DEFAULT_MANDATE_DOCUMENT } from "./mandates/default";
import { FRENCH_MANDATE_DOCUMENT } from "./mandates/france";

export type CompanyIdentityRow = {
  label: string;
  value: string;
};

export type CompanyKycIdentity = {
  /** What the mandate and the follow-up email name the company by. */
  rows: CompanyIdentityRow[];
  /** The jurisdiction specific payload Arratech's KYC expects, when defined. */
  metaData?: Record<string, string>;
  /** Caveats support should know about before Arratech reviews the file. */
  notes: string[];
};

/** Everything a document needs to name the company by its own numbers. */
export type CompanyIdentitySource = Pick<
  Company,
  "country" | "enterpriseNumber" | "enterpriseNumberScheme" | "vatNumber"
>;

export type MandateInput = {
  reference: string;
  company: Company;
  identifiers: CompanyIdentifier[];
  identity: CompanyKycIdentity;
  signatory: {
    firstName: string;
    lastName: string;
    role: string;
  };
  signedAt: Date;
  /**
   * The identity verification that signs the mandate. Null renders the draft
   * shown to the signatory before they hand over to Didit.
   */
  proofReference: string | null;
};

/**
 * The mandate one jurisdiction files with its KYC. Countries whose authority
 * prescribes a model implement it here; everyone else gets the default one.
 *
 * To add a country: write a module exporting a MandateDocument, add its
 * template next to the others, and register it in MANDATE_DOCUMENTS below.
 */
export type MandateDocument = {
  /**
   * The document's own name. Shown verbatim wherever the UI offers it, so that
   * the page and the PDF the signatory downloads call it the same thing.
   */
  title: string;
  /** Printed as the signatory's function when they did not state one. */
  defaultSignatoryRole: string;
  /**
   * Names the company for its KYC file, from everything it told us about
   * itself. Throws a UserFacingError when the numbers cannot be trusted.
   */
  resolveIdentity(
    company: CompanyIdentitySource,
    identifiers: Pick<CompanyIdentifier, "scheme" | "identifier">[],
  ): CompanyKycIdentity;
  /** Mustache template rendered to the PDF that is filed with the KYC. */
  template: string;
  /** Turns the mandate into what its template renders. */
  buildTemplateData(input: MandateInput): unknown;
};

const MANDATE_DOCUMENTS: Record<string, MandateDocument> = {
  FR: FRENCH_MANDATE_DOCUMENT,
};

export function getMandateDocument(
  country: string | null | undefined,
): MandateDocument {
  return (country ? MANDATE_DOCUMENTS[country] : undefined) ?? DEFAULT_MANDATE_DOCUMENT;
}

export function resolveCompanyKycIdentity(
  company: CompanyIdentitySource,
  identifiers: Pick<CompanyIdentifier, "scheme" | "identifier">[],
): CompanyKycIdentity {
  return getMandateDocument(company.country).resolveIdentity(company, identifiers);
}

export async function renderMandatePdf(input: MandateInput): Promise<Buffer> {
  const document = getMandateDocument(input.company.country);
  const pdf = await renderTailwindTemplate(
    document.template,
    document.buildTemplateData(input),
    { preview: false },
  );
  return pdf as Buffer;
}
