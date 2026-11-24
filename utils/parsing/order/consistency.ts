import { Decimal } from "decimal.js";
import type { Discrepancy } from "@peppol/types/intake";
import { amount, computedLineAmount, lineDiscrepancies, totalsDiscrepancies } from "../invoice/consistency";
import type { DocumentLine } from "../invoice/schemas";
import type { Order } from "./schemas";

// The arithmetic of an order, checked against the values the order states. Prices,
// VAT and totals are optional in an order, so only what the order states is checked:
// a line without a price has no amount to check, and an order without totals has no
// totals to check.

type OrderAmounts = Pick<Order, "lines" | "discounts" | "surcharges" | "totals" | "vat">;

type VatOf = { category?: string | null; percentage?: string | null } | null | undefined;

const CENT = new Decimal("0.01");

/**
 * The VAT total that the VAT categories of the lines, discounts and surcharges give,
 * rounded per category and rate, with the number of entries it adds up. Null when an
 * entry has no VAT category, rate or amount.
 */
function expectedVat(order: OrderAmounts, lineAmounts: (Decimal | null)[]) {
  const groups = new Map<string, { rate: Decimal; taxable: Decimal }>();
  const add = (vat: VatOf, taxable: Decimal | null) => {
    const rate = amount(vat?.percentage);
    if (!vat?.category || !rate || !taxable) {
      return false;
    }
    const key = `${vat.category}:${rate.toString()}`;
    const group = groups.get(key) ?? { rate, taxable: new Decimal(0) };
    groups.set(key, { rate, taxable: group.taxable.plus(taxable) });
    return true;
  };
  const entries = [
    ...order.lines.map((line, index) => add(line.vat, lineAmounts[index] ?? null)),
    ...(order.discounts ?? []).map((discount) => add(discount.vat, amount(discount.amount)?.neg() ?? null)),
    ...(order.surcharges ?? []).map((surcharge) => add(surcharge.vat, amount(surcharge.amount))),
  ];
  if (!entries.every(Boolean)) {
    return null;
  }
  const total = [...groups.values()].reduce(
    (sum, group) => sum.plus(group.taxable.mul(group.rate).div(100).toNearest(0.01)),
    new Decimal(0),
  );
  return { total, count: entries.length };
}

/** The VAT total of the order, when its lines, discounts and surcharges give another one. */
function vatDiscrepancies(order: OrderAmounts, lineAmounts: (Decimal | null)[]): Discrepancy[] {
  const stated = amount(order.vat?.totalVatAmount);
  const expected = stated ? expectedVat(order, lineAmounts) : null;
  // An order can round the VAT of each line, which adds up to a cent per entry.
  if (!stated || !expected || stated.minus(expected.total).abs().lte(CENT.mul(expected.count))) {
    return [];
  }
  return [
    {
      pointer: "/vat/totalVatAmount",
      stated: stated.toFixed(2),
      expected: expected.total.toFixed(2),
      message: `The total VAT is ${stated.toFixed(2)}, but the VAT categories and rates of the lines, discounts and surcharges give ${expected.total.toFixed(2)}.`,
    },
  ];
}

/**
 * The amounts of an order that its other amounts contradict: a line amount that is not
 * its quantity times its price, totals that do not add up, and a VAT total that the VAT
 * of the lines does not give. An order has no VAT breakdown, so none is checked.
 */
export function checkOrderConsistency(order: OrderAmounts): Discrepancy[] {
  if (!Array.isArray(order?.lines)) {
    return [];
  }
  const lines = order.lines as unknown as DocumentLine[];
  // A line amount the order leaves out counts as its quantity times its price; a line
  // without a price has no amount.
  const lineAmounts = lines.map((line) => amount(line.netAmount) ?? computedLineAmount(line));
  return [
    ...lineDiscrepancies(lines),
    ...vatDiscrepancies(order, lineAmounts),
    ...totalsDiscrepancies(order, lineAmounts),
  ];
}
