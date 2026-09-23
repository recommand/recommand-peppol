import type { Company } from "@peppol/data/companies";
import type { CompanyIdentifier } from "@peppol/data/company-identifiers";
import { MANDATE_TEMPLATE } from "@peppol/templates/mandate";
import { getCountryName } from "@peppol/utils/countries";
import { formatMandateDate, MANDATARY, OPERATOR } from "./shared";
import {
  type CompanyIdentityRow,
  type CompanyIdentitySource,
  type CompanyKycIdentity,
  type MandateDocument,
  type MandateInput,
} from "../mandate";

const TIME_ZONE = "Europe/Brussels";

const TITLE = "Mandate for electronic invoicing";

export type MandateScopeItem = {
  title: string;
  description: string;
};

export type MandateTemplateData = {
  title: string;
  reference: string;
  issueDate: string;
  company: {
    legalName: string;
    street: string;
    postalCode: string;
    city: string;
    countryName: string;
    rows: CompanyIdentityRow[];
  };
  platform: {
    description: string;
  };
  scopeItems: MandateScopeItem[];
  electronicAddresses: { value: string }[];
  effectiveDate: string;
  durationLabel: string;
  signatory: {
    fullName: string;
    role: string;
    signedAt: string;
    proofMethod: string;
    /** Null while the mandate is still the draft the signatory is reading. */
    proofReference: string | null;
  };
};

/**
 * Names the company by whatever legal and tax identifiers it registered, as is.
 * Only countries with a document of their own check their number formats.
 */
function resolveIdentity(
  company: CompanyIdentitySource,
  _identifiers: Pick<CompanyIdentifier, "scheme" | "identifier">[],
): CompanyKycIdentity {
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

function buildScopeItems(company: Company): MandateScopeItem[] {
  const scopeItems: MandateScopeItem[] = [];

  if (company.isSmpRecipient) {
    scopeItems.push({
      title: "Receiving electronic invoices",
      description:
        "Receiving the electronic invoices, credit notes and responses addressed to the company's electronic addresses, on its behalf.",
    });
  }

  if (company.accessPointProvider === "at-shared-ap-fr") {
    scopeItems.push({
      title: "Sending electronic invoices",
      description:
        "Transmitting the invoices, credit notes and responses issued by the company to the platforms of its trading partners.",
    });
  }

  scopeItems.push({
    title: "Directory registration",
    description:
      "Registering, updating and removing the company's electronic addresses and the document types it accepts in the Peppol network and its directory.",
  });

  return scopeItems;
}

export function buildMandateTemplateData(input: MandateInput): MandateTemplateData {
  const { company, identifiers, identity, signatory, signedAt } = input;

  return {
    title: TITLE,
    reference: input.reference,
    issueDate: formatMandateDate(signedAt, TIME_ZONE, "yyyy-MM-dd"),
    company: {
      legalName: company.name,
      street: company.address,
      postalCode: company.postalCode,
      city: company.city,
      countryName: getCountryName(company.country),
      rows: identity.rows,
    },
    platform: {
      description: `${MANDATARY.shortName}, ${MANDATARY.role}. Mandate concluded through ${OPERATOR.name}, ${OPERATOR.role}.`,
    },
    scopeItems: buildScopeItems(company),
    electronicAddresses: identifiers.map((identifier) => ({
      value: `${identifier.scheme}:${identifier.identifier}`,
    })),
    effectiveDate: formatMandateDate(signedAt, TIME_ZONE, "yyyy-MM-dd"),
    durationLabel: "an indefinite term",
    signatory: {
      fullName: `${signatory.firstName} ${signatory.lastName}`.trim(),
      role: signatory.role,
      signedAt: formatMandateDate(signedAt, TIME_ZONE, "yyyy-MM-dd HH:mm"),
      proofMethod: "Didit (electronic identity verification)",
      proofReference: input.proofReference,
    },
  };
}

export const DEFAULT_MANDATE_DOCUMENT: MandateDocument = {
  title: TITLE,
  defaultSignatoryRole: "Legal representative",
  resolveIdentity,
  template: MANDATE_TEMPLATE,
  buildTemplateData: buildMandateTemplateData,
};
