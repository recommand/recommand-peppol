import { z } from "zod";
import { fetchArratech, getArratechConfig } from "@peppol/data/at/client";
import type { FrenchB2BiReport } from "@peppol/utils/parsing/b2bi-reporting/france";
import type { FrenchB2CReport } from "@peppol/utils/parsing/b2c-reporting/france";

/**
 * Every French e-reporting event is filed under the FR-F10 profile, as a single
 * atomic event rather than a finished report: Arratech determines the VAT period
 * and aggregates. The four sub-fluxes are the sales (10.1, 10.3) and payment
 * (10.2, 10.4) halves of the cross-border B2B and the B2C regimes.
 */
const FRENCH_REPORTING_PROFILE = "FR-F10";

/** The declarant files as the seller of the reported operations. */
const FRENCH_DECLARANT_ROLE = "SE";

/** The only "cadre de facturation" Arratech documents for a 10.1 event. */
const FRENCH_INVOICE_CADRE = "S1";

/** French companies are identified by their SIREN, which is ICD scheme 0002. */
const FRENCH_SIREN_SCHEME = "0002";

export type FrenchDeclarant = {
  siren: string;
  name: string;
  role: typeof FRENCH_DECLARANT_ROLE;
};

export type FrenchReportingParty = {
  companyId: string;
  schemeId: string;
  vatId?: string;
  countryId: string;
};

function getFrenchSiren({
  enterpriseNumber,
}: {
  enterpriseNumber: string | null;
}): string | null {
  const normalizedEnterpriseNumber = enterpriseNumber?.replace(/\s/g, "");
  if (normalizedEnterpriseNumber && /^\d{9}$/.test(normalizedEnterpriseNumber)) {
    return normalizedEnterpriseNumber;
  }

  return null;
}

/**
 * Builds the declarant block for a French filing from a company. Returns null when
 * the company has no usable 9-digit SIREN, which the caller must reject.
 */
export function buildFrenchDeclarant(company: {
  name: string;
  enterpriseNumber: string | null;
}): FrenchDeclarant | null {
  const siren = getFrenchSiren(company);
  if (!siren) {
    return null;
  }
  return { siren, name: company.name, role: FRENCH_DECLARANT_ROLE };
}

/**
 * The seller party a cross-border invoice event names, which is always the
 * declarant itself. Returns null when the company has no usable SIREN or no VAT
 * number, both of which a cross-border operation is reported under.
 */
export function buildFrenchSeller(company: {
  enterpriseNumber: string | null;
  vatNumber: string | null;
}): FrenchReportingParty | null {
  const siren = getFrenchSiren(company);
  if (!siren || !company.vatNumber) {
    return null;
  }
  return {
    companyId: siren,
    schemeId: FRENCH_SIREN_SCHEME,
    vatId: company.vatNumber,
    countryId: "FR",
  };
}

const arratechFlowResponseSchema = z.object({
  flowId: z.string().min(1),
});

/**
 * A correction resends the original reference under transmission type RE; a
 * cancellation resends it as a CANCEL operation. Both keep the reference of the
 * event they act on, which is what ties them to it on Arratech's side.
 */
const arratechActionByPublicAction = {
  submit: {
    transmissionType: "IN",
    operation: "SUBMIT",
  },
  correct: {
    transmissionType: "RE",
    operation: "SUBMIT",
  },
  cancel: {
    transmissionType: "IN",
    operation: "CANCEL",
  },
} as const;

type FrenchReportAction = keyof typeof arratechActionByPublicAction;

/**
 * Wraps a sub-flux payload in the FR-F10 envelope every submission shares.
 */
function toArratechFlow(
  report: { reference: string; action: FrenchReportAction },
  declarant: FrenchDeclarant,
  flow: { subFlux: string; payload: object },
) {
  return {
    profile: FRENCH_REPORTING_PROFILE,
    event: {
      declarant,
      clientOperationRef: report.reference,
      ...arratechActionByPublicAction[report.action],
      subFlux: flow.subFlux,
      payload: flow.payload,
    },
  };
}

export function toArratechB2CFlow(
  input: FrenchB2CReport,
  declarant: FrenchDeclarant,
) {
  if (input.type === "sales") {
    return toArratechFlow(input, declarant, {
      subFlux: "10.3",
      payload: {
        date: input.date,
        currency: input.currency,
        categoryCode: input.category === "goods" ? "TLB1" : "TPS1",
        taxExclusiveAmount: input.taxExclusiveAmount,
        taxTotal: input.taxAmount,
        count: input.transactionCount,
        subTotals: input.vatBreakdown.map((subtotal) => ({
          taxPercent: subtotal.percentage,
          taxableAmount: subtotal.taxableAmount,
          taxTotal: subtotal.taxAmount,
        })),
      },
    });
  }

  return toArratechFlow(input, declarant, {
    subFlux: "10.4",
    payload: {
      paymentDate: input.date,
      subTotals: input.vatBreakdown.map((subtotal) => ({
        taxPercent: subtotal.percentage,
        currencyCode: "EUR",
        amount: subtotal.amount,
      })),
    },
  });
}

export function toArratechB2BiFlow(
  input: FrenchB2BiReport,
  declarant: FrenchDeclarant,
  seller: FrenchReportingParty,
) {
  if (input.type === "invoice") {
    return toArratechFlow(input, declarant, {
      subFlux: "10.1",
      payload: {
        id: input.documentNumber,
        issueDate: input.issueDate,
        typeCode: input.documentType === "creditNote" ? "381" : "380",
        currencyCode: input.currency,
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
        cadre: FRENCH_INVOICE_CADRE,
        seller,
        buyer: {
          companyId: input.buyer.enterpriseNumber,
          schemeId: input.buyer.enterpriseNumberScheme,
          ...(input.buyer.vatNumber ? { vatId: input.buyer.vatNumber } : {}),
          countryId: input.buyer.country,
        },
        taxExclusiveAmount: input.taxExclusiveAmount,
        taxAmount: input.taxAmount,
        taxSubTotals: input.vatBreakdown.map((subtotal) => ({
          taxableAmount: subtotal.taxableAmount,
          taxAmount: subtotal.taxAmount,
          categoryCode: subtotal.category,
          percent: subtotal.percentage,
          ...(subtotal.exemptionReason
            ? { exemptionReason: subtotal.exemptionReason }
            : {}),
          ...(subtotal.exemptionReasonCode
            ? { exemptionReasonCode: subtotal.exemptionReasonCode }
            : {}),
        })),
      },
    });
  }

  return toArratechFlow(input, declarant, {
    subFlux: "10.2",
    payload: {
      invoiceId: input.invoiceNumber,
      issueDate: input.issueDate,
      paymentDate: input.date,
      subTotals: input.vatBreakdown.map((subtotal) => ({
        taxPercent: subtotal.percentage,
        currencyCode: input.currency,
        amount: subtotal.amount,
      })),
    },
  });
}

async function getReportingErrorMessage(response: Response): Promise<string> {
  const text = (await response.text()).slice(0, 1000);
  if (!text) {
    return response.statusText;
  }

  try {
    const json = JSON.parse(text) as { error?: string; message?: string };
    return json.error ?? json.message ?? text;
  } catch {
    return text;
  }
}

async function submitArratechFlow({
  flow,
  useTestNetwork,
}: {
  flow: object;
  useTestNetwork: boolean;
}): Promise<{ flowId: string }> {
  const config = getArratechConfig(useTestNetwork);
  const response = await fetchArratech(
    `/orgs/${config.orgId}/tax-reporting/fr-f10/submissions`,
    {
      useTestNetwork,
      method: "POST",
      body: JSON.stringify(flow),
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    const message = await getReportingErrorMessage(response);
    throw new Error(
      `Arratech reporting request failed with status ${response.status}: ${message}`,
    );
  }

  return arratechFlowResponseSchema.parse(await response.json());
}

export async function submitArratechB2CReport({
  input,
  declarant,
  useTestNetwork,
}: {
  input: FrenchB2CReport;
  declarant: FrenchDeclarant;
  useTestNetwork: boolean;
}): Promise<{ flowId: string }> {
  return submitArratechFlow({
    flow: toArratechB2CFlow(input, declarant),
    useTestNetwork,
  });
}

export async function submitArratechB2BiReport({
  input,
  declarant,
  seller,
  useTestNetwork,
}: {
  input: FrenchB2BiReport;
  declarant: FrenchDeclarant;
  seller: FrenchReportingParty;
  useTestNetwork: boolean;
}): Promise<{ flowId: string }> {
  return submitArratechFlow({
    flow: toArratechB2BiFlow(input, declarant, seller),
    useTestNetwork,
  });
}
