import { Decimal } from "decimal.js";
import type { Discrepancy } from "@peppol/types/intake";
import { calculateLineAmount } from "./calculations";
import type { DocumentLine, Invoice } from "./schemas";

// The arithmetic of a billing document, checked against the values the document states.
// It recomputes with the calculations the send API uses, so a document passes when the
// API would compute the same amounts from its lines. A value the document does not
// state is not checked.

type BillingDocument = Pick<Invoice, "lines" | "discounts" | "surcharges" | "totals" | "vat">;
type PricedLine = Pick<DocumentLine, "quantity" | "netPriceAmount" | "baseQuantity" | "discounts" | "surcharges">;

/** Sums of amounts that the document states, which it rounded to the cent each. */
const SUM_TOLERANCE = new Decimal("0.01");

export function amount(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  try {
    return new Decimal(value);
  } catch {
    return null;
  }
}

function differs(stated: Decimal, expected: Decimal, tolerance: Decimal) {
  return stated.minus(expected).abs().gt(tolerance);
}

function total(values: Decimal[]) {
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0));
}

function money(value: Decimal) {
  return value.toFixed(2);
}

/** The amount of a line from its quantity, price, base quantity, discounts and surcharges, or null when they are not numbers. */
export function computedLineAmount(line: PricedLine): Decimal | null {
  try {
    return new Decimal(calculateLineAmount(line as DocumentLine));
  } catch {
    return null;
  }
}

/**
 * How far a printed line amount may be from the amount its quantity and price give: a
 * cent, plus the rounding of the printed price. A price printed with two decimals can
 * be half a cent off for each unit it is multiplied by.
 */
export function lineAmountTolerance(line: Pick<DocumentLine, "quantity" | "netPriceAmount" | "baseQuantity">): Decimal {
  const decimals = Math.max(line.netPriceAmount.split(".")[1]?.length ?? 0, 2);
  const quantity = amount(line.quantity)?.abs() ?? new Decimal(0);
  const base = amount(line.baseQuantity) ?? new Decimal(1);
  const units = base.isZero() ? quantity : quantity.div(base.abs());
  return SUM_TOLERANCE.plus(new Decimal(10).pow(-decimals).div(2).mul(units));
}

/** Each line amount that is not its quantity times its price. A line without a price or an amount is not checked. */
export function lineDiscrepancies(lines: BillingDocument["lines"]): Discrepancy[] {
  return lines.flatMap((line, index) => {
    const stated = amount(line.netAmount);
    const expected = computedLineAmount(line);
    if (!stated || !expected || !differs(stated, expected, lineAmountTolerance(line))) {
      return [];
    }
    const base = line.baseQuantity && !amount(line.baseQuantity)?.eq(1) ? ` / base quantity ${line.baseQuantity}` : "";
    const adjusted = line.discounts?.length || line.surcharges?.length ? ", with its discounts and surcharges," : "";
    return [
      {
        pointer: `/lines/${index}/netAmount`,
        stated: money(stated),
        expected: money(expected),
        message: `The line amount is ${money(stated)}, but quantity ${line.quantity} × price ${line.netPriceAmount}${base}${adjusted} gives ${money(expected)}.`,
      },
    ];
  });
}

type VatGroup = { category: string; percentage: string; taxable: Decimal; count: number };

function vatKey(category: string, percentage: string) {
  return `${category}:${new Decimal(percentage).toString()}`;
}

/** The taxable amount of each VAT category and rate, from the lines, discounts and surcharges. */
function vatGroups(document: BillingDocument, lineAmounts: (Decimal | null)[]): Map<string, VatGroup> | null {
  const groups = new Map<string, VatGroup>();
  const add = (vat: { category: string; percentage: string }, taxable: Decimal | null) => {
    if (!taxable || !amount(vat.percentage)) {
      return false;
    }
    const key = vatKey(vat.category, vat.percentage);
    const group = groups.get(key) ?? { category: vat.category, percentage: vat.percentage, taxable: new Decimal(0), count: 0 };
    groups.set(key, { ...group, taxable: group.taxable.plus(taxable), count: group.count + 1 });
    return true;
  };
  const complete = [
    ...document.lines.map((line, index) => add(line.vat, lineAmounts[index] ?? null)),
    ...(document.discounts ?? []).map((discount) => add(discount.vat, amount(discount.amount)?.neg() ?? null)),
    ...(document.surcharges ?? []).map((surcharge) => add(surcharge.vat, amount(surcharge.amount))),
  ].every(Boolean);
  return complete ? groups : null;
}

function vatDiscrepancies(document: BillingDocument, lineAmounts: (Decimal | null)[]): Discrepancy[] {
  const vat = document.vat;
  const groups = vatGroups(document, lineAmounts);
  if (!vat || !groups) {
    return [];
  }
  const discrepancies: Discrepancy[] = [];
  const seen = new Set<string>();
  vat.subtotals.forEach((subtotal, index) => {
    const percentage = amount(subtotal.percentage);
    if (!percentage) {
      return;
    }
    const label = `VAT category ${subtotal.category} at ${subtotal.percentage}%`;
    const key = vatKey(subtotal.category, subtotal.percentage);
    const group = groups.get(key);
    seen.add(key);
    if (!group) {
      discrepancies.push({
        pointer: `/vat/subtotals/${index}/category`,
        stated: `${subtotal.category} ${subtotal.percentage}%`,
        expected: [...groups.values()].map((other) => `${other.category} ${other.percentage}%`).join(", "),
        message: `The VAT breakdown has ${label}, but no line, discount or surcharge has that category and rate.`,
      });
    }
    const taxable = amount(subtotal.taxableAmount);
    if (group && taxable && differs(taxable, group.taxable, SUM_TOLERANCE)) {
      discrepancies.push({
        pointer: `/vat/subtotals/${index}/taxableAmount`,
        stated: money(taxable),
        expected: money(group.taxable),
        message: `The taxable amount of ${label} is ${money(taxable)}, but the lines, discounts and surcharges with that category and rate add up to ${money(group.taxable)}.`,
      });
    }
    const vatAmount = amount(subtotal.vatAmount);
    if (taxable && vatAmount) {
      // A document can round the VAT of each line, which adds up to a cent per line.
      const expected = taxable.mul(percentage).div(100).toNearest(0.01);
      const tolerance = SUM_TOLERANCE.mul(Math.max(group?.count ?? 1, 1));
      if (differs(vatAmount, expected, tolerance)) {
        discrepancies.push({
          pointer: `/vat/subtotals/${index}/vatAmount`,
          stated: money(vatAmount),
          expected: money(expected),
          message: `The VAT amount of ${label} is ${money(vatAmount)}, but ${subtotal.percentage}% of ${money(taxable)} is ${money(expected)}.`,
        });
      }
    }
  });
  for (const [key, group] of groups) {
    if (!seen.has(key)) {
      discrepancies.push({
        pointer: "/vat/subtotals",
        stated: vat.subtotals.map((subtotal) => `${subtotal.category} ${subtotal.percentage}%`).join(", "),
        expected: `${group.category} ${group.percentage}%`,
        message: `Lines, discounts or surcharges have VAT category ${group.category} at ${group.percentage}%, but the VAT breakdown has no entry for it.`,
      });
    }
  }
  const totalVat = amount(vat.totalVatAmount);
  const subtotalVat = vat.subtotals.map((subtotal) => amount(subtotal.vatAmount));
  if (totalVat && subtotalVat.every((value) => value !== null)) {
    const expected = total(subtotalVat as Decimal[]);
    if (differs(totalVat, expected, SUM_TOLERANCE)) {
      discrepancies.push({
        pointer: "/vat/totalVatAmount",
        stated: money(totalVat),
        expected: money(expected),
        message: `The total VAT is ${money(totalVat)}, but the VAT amounts of the breakdown add up to ${money(expected)}.`,
      });
    }
  }
  return discrepancies;
}

/**
 * The totals that the line amounts, the document discounts and surcharges and the VAT
 * total contradict. `lineAmounts` has null for a line whose amount is not known.
 */
export function totalsDiscrepancies(
  document: {
    discounts?: { amount: string }[] | null;
    surcharges?: { amount: string }[] | null;
    totals?: { linesAmount?: string | null; taxExclusiveAmount?: string | null; taxInclusiveAmount?: string | null } | null;
    vat?: { totalVatAmount?: string | null } | null;
  },
  lineAmounts: (Decimal | null)[],
): Discrepancy[] {
  const totals = document.totals;
  if (!totals) {
    return [];
  }
  const discrepancies: Discrepancy[] = [];
  const linesAmount = amount(totals.linesAmount);
  const linesTotal = lineAmounts.every((value) => value !== null) ? total(lineAmounts as Decimal[]) : null;
  if (linesAmount && linesTotal && differs(linesAmount, linesTotal, SUM_TOLERANCE)) {
    discrepancies.push({
      pointer: "/totals/linesAmount",
      stated: money(linesAmount),
      expected: money(linesTotal),
      message: `The total of the lines is ${money(linesAmount)}, but the line amounts add up to ${money(linesTotal)}.`,
    });
  }

  const discounts = (document.discounts ?? []).map((discount) => amount(discount.amount));
  const surcharges = (document.surcharges ?? []).map((surcharge) => amount(surcharge.amount));
  const taxExclusive = amount(totals.taxExclusiveAmount);
  const lines = linesAmount ?? linesTotal;
  if (taxExclusive && lines && [...discounts, ...surcharges].every((value) => value !== null)) {
    const discountTotal = total(discounts as Decimal[]);
    const surchargeTotal = total(surcharges as Decimal[]);
    const expected = lines.minus(discountTotal).plus(surchargeTotal);
    if (differs(taxExclusive, expected, SUM_TOLERANCE)) {
      discrepancies.push({
        pointer: "/totals/taxExclusiveAmount",
        stated: money(taxExclusive),
        expected: money(expected),
        message: `The amount without VAT is ${money(taxExclusive)}, but the lines (${money(lines)}) minus the discounts (${money(discountTotal)}) plus the surcharges (${money(surchargeTotal)}) give ${money(expected)}.`,
      });
    }
  }

  const taxInclusive = amount(totals.taxInclusiveAmount);
  const totalVat = amount(document.vat?.totalVatAmount);
  if (taxInclusive && taxExclusive && totalVat && differs(taxInclusive, taxExclusive.plus(totalVat), SUM_TOLERANCE)) {
    const expected = taxExclusive.plus(totalVat);
    discrepancies.push({
      pointer: "/totals/taxInclusiveAmount",
      stated: money(taxInclusive),
      expected: money(expected),
      message: `The amount with VAT is ${money(taxInclusive)}, but the amount without VAT (${money(taxExclusive)}) plus the VAT (${money(totalVat)}) gives ${money(expected)}.`,
    });
  }
  return discrepancies;
}

/**
 * The amounts of a billing document that its other amounts contradict: a line amount
 * that is not its quantity times its price, a VAT breakdown that does not match the
 * lines, and totals that do not add up.
 */
export function checkBillingConsistency(document: BillingDocument): Discrepancy[] {
  if (!Array.isArray(document?.lines)) {
    return [];
  }
  // A line amount the document leaves out counts as its quantity times its price.
  const lineAmounts = document.lines.map((line) => amount(line.netAmount) ?? computedLineAmount(line));
  return [
    ...lineDiscrepancies(document.lines),
    ...vatDiscrepancies(document, lineAmounts),
    ...totalsDiscrepancies(document, lineAmounts),
  ];
}
