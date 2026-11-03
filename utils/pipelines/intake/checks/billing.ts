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
  vat?: { totalVatAmount?: string | null; subtotals?: VatSubtotal[] | null } | null;
};

type VatSubtotal = {
  category?: unknown;
  percentage?: string | null;
  taxableAmount?: string | null;
  vatAmount?: string | null;
  exemptionReason?: string | null;
};

/** Extraction rules about the VAT of a billing document, which models often break. */
export const BILLING_INSTRUCTIONS = [
  "Write the VAT rate as a number. When the document prints a VAT code, use the rate that the document gives for that code.",
  "Use VAT category S only with a rate above 0. Use the category that the document's VAT text gives, for example AE for reverse charge, K for an intra-community supply, E for an exemption. These categories have rate 0.",
];

function decimal(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return new Decimal(value);
  } catch {
    return null;
  }
}

/**
 * One VAT breakdown per VAT category and rate, as the formats require. A document can
 * print one per line, for example a deposit and its return: their printed amounts are
 * added up. A breakdown whose amounts are not numbers stays as it is.
 */
export function billingNormalize(document: unknown): unknown {
  const billing = document as BillingDocument | null;
  const subtotals = billing?.vat?.subtotals;
  if (!Array.isArray(subtotals)) {
    return document;
  }
  const merged: VatSubtotal[] = [];
  const byKey = new Map<string, VatSubtotal>();
  for (const subtotal of subtotals) {
    const rate = decimal(subtotal?.percentage);
    const key = typeof subtotal?.category === "string" && rate ? `${subtotal.category}:${rate.toString()}` : null;
    const existing = key ? byKey.get(key) : undefined;
    const taxable = [decimal(existing?.taxableAmount), decimal(subtotal?.taxableAmount)];
    const vat = [decimal(existing?.vatAmount), decimal(subtotal?.vatAmount)];
    if (!existing || [...taxable, ...vat].some((amount) => amount === null)) {
      merged.push(subtotal);
      if (key && !existing) {
        byKey.set(key, subtotal);
      }
      continue;
    }
    const reasons = [...new Set([existing.exemptionReason, subtotal.exemptionReason].filter(Boolean))];
    const combined: VatSubtotal = {
      ...existing,
      taxableAmount: taxable[0]!.plus(taxable[1]!).toFixed(2),
      vatAmount: vat[0]!.plus(vat[1]!).toFixed(2),
      ...(reasons.length > 0 && { exemptionReason: reasons.join("; ") }),
    };
    merged[merged.indexOf(existing)] = combined;
    byKey.set(key!, combined);
  }
  return { ...billing, vat: { ...billing!.vat, subtotals: merged } };
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
