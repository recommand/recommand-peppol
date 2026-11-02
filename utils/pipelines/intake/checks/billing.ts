import Decimal from "decimal.js";
import type { Finding, Issue } from "@peppol/types/intake";

type BillingDocument = {
  lines?: { netAmount?: string | null }[] | null;
  totals?: {
    linesAmount?: string | null;
    taxExclusiveAmount?: string | null;
    taxInclusiveAmount?: string | null;
    payableAmount?: string | null;
  } | null;
  vat?: { totalVatAmount?: string | null } | null;
};

function decimal(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return new Decimal(value);
  } catch {
    return null;
  }
}

/** A billing document must state what is to be paid. */
export function billingMinimumEvidence(document: unknown): Issue[] {
  const totals = (document as BillingDocument).totals;
  if (decimal(totals?.payableAmount) ?? decimal(totals?.taxInclusiveAmount)) {
    return [];
  }
  return [{ code: "missing_payable_amount", message: "The payable amount is missing.", pointer: "/totals/payableAmount" }];
}

function inconsistent(message: string, pointer: string): Finding {
  return { code: "inconsistent_totals", severity: "warning", scope: "business", message, pointer: `/content${pointer}` };
}

/** Totals that the document states and that do not add up, as the document states them. */
export function billingTotalsCheck(document: unknown): Finding[] {
  const { lines, totals, vat } = document as BillingDocument;
  const findings: Finding[] = [];
  const linesAmount = decimal(totals?.linesAmount);
  const lineAmounts = (lines ?? []).map((line) => decimal(line.netAmount));
  if (linesAmount && lineAmounts.length > 0 && lineAmounts.every((amount) => amount !== null)) {
    const sum = lineAmounts.reduce((total: Decimal, amount) => total.plus(amount!), new Decimal(0));
    if (!sum.eq(linesAmount)) {
      findings.push(inconsistent(`The lines add up to ${sum.toFixed(2)}, the document states ${linesAmount.toFixed(2)}.`, "/totals/linesAmount"));
    }
  }
  const taxExclusive = decimal(totals?.taxExclusiveAmount);
  const taxInclusive = decimal(totals?.taxInclusiveAmount);
  const taxAmount = decimal(vat?.totalVatAmount);
  if (taxExclusive && taxInclusive && taxAmount && !taxExclusive.plus(taxAmount).eq(taxInclusive)) {
    findings.push(
      inconsistent(
        `The amount without VAT plus the VAT is ${taxExclusive.plus(taxAmount).toFixed(2)}, the document states ${taxInclusive.toFixed(2)}.`,
        "/totals/taxInclusiveAmount",
      ),
    );
  }
  return findings;
}
