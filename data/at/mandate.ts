import type { Company } from "@peppol/data/companies";
import type { CompanyIdentifier } from "@peppol/data/company-identifiers";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { MANDATE_TEMPLATE } from "@peppol/templates/mandate";
import { getCountryName } from "@peppol/utils/countries";
import { renderTailwindTemplate } from "@peppol/utils/tailwind-pdf";
import { FRANCE_MANDATE_COPY, resolveFrenchCompanyIdentity } from "./france";

/**
 * Arratech is the platform the company mandates towards the authorities;
 * Recommand is the operator the company contracted with.
 */
const MANDATARY = {
  name: "Arratech",
  role: "Peppol access point and service metadata publisher",
};

const OPERATOR = {
  name: "Recommand",
  role: "e-invoicing operator",
};

export const DEFAULT_SIGNATORY_ROLE = "Legal representative";

const PROOF_METHOD = "Didit (electronic identity verification)";

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

/**
 * Names the company for its KYC file. Only France has a number format we know
 * how to check, so companies from other countries are named by whatever legal
 * and tax identifiers they registered, as is.
 */
export function resolveCompanyKycIdentity(
  company: Pick<Company, "country" | "enterpriseNumber" | "enterpriseNumberScheme" | "vatNumber">,
  identifiers: Pick<CompanyIdentifier, "scheme" | "identifier">[],
): CompanyKycIdentity {
  if (company.country === "FR") {
    return resolveFrenchCompanyIdentity(company, identifiers);
  }

  const rows: CompanyIdentityRow[] = [];
  if (company.enterpriseNumber) {
    rows.push({
      label: company.enterpriseNumberScheme
        ? `Company number (${company.enterpriseNumberScheme})`
        : "Company number",
      value: company.enterpriseNumber,
    });
  }
  if (company.vatNumber) {
    rows.push({ label: "VAT number", value: company.vatNumber });
  }

  return { rows, notes: [] };
}

type MandateParty = {
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  countryName: string;
  rows: CompanyIdentityRow[];
};

export type MandateScopeItem = {
  title: string;
  description: string;
};

type MandateElectronicAddress = {
  value: string;
};

type MandateSignatory = {
  fullName: string;
  role: string;
  signedAt: string;
  proofMethod: string;
  proofReference: string;
};

export type MandateTemplateData = {
  reference: string;
  issueDate: string;
  frenchTitle: string | null;
  company: MandateParty;
  platform: {
    name: string;
    role: string;
    registration: string | null;
    operator: typeof OPERATOR;
  };
  scopeItems: MandateScopeItem[];
  electronicAddresses: MandateElectronicAddress[];
  effectiveDate: string;
  durationLabel: string;
  signatory: MandateSignatory;
};

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
  proofReference: string;
};

function formatMandateDate(date: Date): string {
  return format(TZDate.tz("Europe/Brussels", date), "yyyy-MM-dd");
}

function formatMandateDateTime(date: Date): string {
  return format(TZDate.tz("Europe/Brussels", date), "yyyy-MM-dd HH:mm");
}

function buildScopeItems(company: Company, isFrance: boolean): MandateScopeItem[] {
  const scopeItems: MandateScopeItem[] = [];

  if (company.isSmpRecipient) {
    scopeItems.push({
      title: "Receiving electronic invoices",
      description: isFrance
        ? FRANCE_MANDATE_COPY.receivingDescription
        : "Receiving the electronic invoices, credit notes and responses addressed to the company's electronic addresses, on its behalf.",
    });
  }

  if (company.accessPointProvider === "at-shared-ap") {
    scopeItems.push({
      title: "Sending electronic invoices",
      description:
        "Transmitting the invoices, credit notes and responses issued by the company to the platforms of its trading partners.",
    });
  }

  if (isFrance) {
    scopeItems.push(FRANCE_MANDATE_COPY.eReportingScopeItem);
  }

  scopeItems.push({
    title: "Directory registration",
    description: isFrance
      ? FRANCE_MANDATE_COPY.directoryDescription
      : "Registering, updating and removing the company's electronic addresses and the document types it accepts in the Peppol network and its directory.",
  });

  return scopeItems;
}

export function buildMandateTemplateData(input: MandateInput): MandateTemplateData {
  const { company, identifiers, identity, signatory, signedAt } = input;
  const isFrance = company.country === "FR";

  return {
    reference: input.reference,
    issueDate: formatMandateDate(signedAt),
    frenchTitle: isFrance ? FRANCE_MANDATE_COPY.title : null,
    company: {
      legalName: company.name,
      street: company.address,
      postalCode: company.postalCode,
      city: company.city,
      countryName: getCountryName(company.country),
      rows: identity.rows,
    },
    platform: {
      name: MANDATARY.name,
      role: isFrance ? FRANCE_MANDATE_COPY.platformRole : MANDATARY.role,
      registration: isFrance ? FRANCE_MANDATE_COPY.platformRegistration : null,
      operator: OPERATOR,
    },
    scopeItems: buildScopeItems(company, isFrance),
    electronicAddresses: identifiers.map((identifier) => ({
      value: `${identifier.scheme}:${identifier.identifier}`,
    })),
    effectiveDate: formatMandateDate(signedAt),
    durationLabel: "an indefinite term",
    signatory: {
      fullName: `${signatory.firstName} ${signatory.lastName}`.trim(),
      role: signatory.role,
      signedAt: formatMandateDateTime(signedAt),
      proofMethod: PROOF_METHOD,
      proofReference: input.proofReference,
    },
  };
}

export async function renderMandatePdf(input: MandateInput): Promise<Buffer> {
  const data = buildMandateTemplateData(input);
  const pdf = await renderTailwindTemplate(MANDATE_TEMPLATE, data, {
    preview: false,
  });
  return pdf as Buffer;
}
