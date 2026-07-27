import { z } from "zod";
import { fetchArratech } from "@peppol/data/at/client";
import type { FrenchB2cReport } from "@peppol/utils/parsing/b2c-reporting/france";

type FrenchDeclarant = {
  siren: string;
  name: string;
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
  return { siren, name: company.name };
}

const arratechFlowResponseSchema = z.object({
  flowId: z.string().min(1),
});

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
    operation: "CANCEL",
  },
} as const;

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

export function toArratechB2cFlow(
  input: FrenchB2cReport,
  declarant: FrenchDeclarant
) {
  const action = arratechActionByPublicAction[input.action];

  if (input.type === "sales") {
    return {
      subFlux: "10.3",
      clientOperationRef: input.reference,
      ...action,
      declarant,
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
    };
  }

  return {
    subFlux: "10.4",
    clientOperationRef: input.reference,
    ...action,
    declarant,
    payload: {
      paymentDate: input.date,
      subTotals: input.vatBreakdown.map((subtotal) => ({
        taxPercent: subtotal.percentage,
        currencyCode: "EUR",
        amount: subtotal.amount,
      })),
    },
  };
}

export async function submitArratechB2cReport({
  input,
  declarant,
  useTestNetwork,
}: {
  input: FrenchB2cReport;
  declarant: FrenchDeclarant;
  useTestNetwork: boolean;
}): Promise<{ flowId: string }> {
  const response = await fetchArratech("/api/reporting/flows", {
    useTestNetwork,
    method: "POST",
    body: JSON.stringify(toArratechB2cFlow(input, declarant)),
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const message = await getReportingErrorMessage(response);
    throw new Error(
      `Arratech reporting request failed with status ${response.status}: ${message}`
    );
  }

  return arratechFlowResponseSchema.parse(await response.json());
}
