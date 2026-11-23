import { UserFacingError } from "@peppol/utils/util";
import {
  calculateLineAmount,
  calculateTotals,
  calculateVat,
  extractTotals,
} from "../invoice/calculations";
import type { DocumentLine, Invoice } from "../invoice/schemas";
import type { Order, OrderLine } from "./schemas";

function isPriced(line: OrderLine): line is OrderLine & { netPriceAmount: string } {
  return line.netPriceAmount !== null && line.netPriceAmount !== undefined;
}

/** Calculated as not subject to VAT, which leaves the total excluding VAT as the total. */
const NO_VAT = { category: "O", percentage: "0.00" } as const;

/**
 * The amounts an order states, calculated as for an invoice (PEPPOL-T01-R008 to R024).
 *
 * Prices and VAT are optional in an order, so the amounts are too. A line without a
 * price states no amount, and an order with such a line states no totals, since a total
 * that leaves lines out would read as the order's value. An order states a VAT total only
 * when every line, discount and surcharge has a VAT category; otherwise it is calculated
 * without VAT, and states no VAT total or total including VAT.
 */
export function calculateOrderAmounts(order: Order) {
  const lines = order.lines.map((line) => ({
    ...line,
    netAmount: isPriced(line)
      ? line.netAmount || calculateLineAmount(line as DocumentLine)
      : null,
  }));
  if (!order.lines.every(isPriced)) {
    return { lines, totals: null, vat: null };
  }

  const isVatKnown = [...order.lines, ...(order.discounts ?? []), ...(order.surcharges ?? [])].every(
    (entry) => entry.vat,
  );
  const withVat = <T extends { vat?: unknown }>(entries: T[] | null | undefined) =>
    entries?.map((entry) => ({ ...entry, vat: entry.vat ?? NO_VAT }));
  const document = {
    lines: withVat(lines),
    discounts: withVat(order.discounts),
    surcharges: withVat(order.surcharges),
    totals: order.totals,
  } as unknown as Invoice;

  const totalVatAmount =
    order.vat?.totalVatAmount ??
    calculateVat({ document, isDocumentValidationEnforced: false }).totalVatAmount;
  const totals = extractTotals(calculateTotals(document));
  return {
    lines,
    vat: isVatKnown ? { totalVatAmount } : null,
    totals: {
      ...totals,
      // calculateTotals always states these; the shared type leaves them optional.
      linesAmount: totals.linesAmount ?? totals.taxExclusiveAmount,
      payableAmount: totals.payableAmount ?? totals.taxInclusiveAmount,
      taxInclusiveAmount: isVatKnown ? totals.taxInclusiveAmount : null,
    },
  };
}

/** The checks the Peppol order rules make that the JSON schema cannot express. */
export function assertOrder(order: Order) {
  const lineIds = order.lines
    .map((line) => line.id)
    .filter((id): id is string => Boolean(id));
  if (new Set(lineIds).size !== lineIds.length) {
    throw new UserFacingError("Every order line needs a unique id (PEPPOL-T01-R001).");
  }
  if (!order.quotationReference && order.lines.some((line) => line.quotationLineReference)) {
    throw new UserFacingError(
      "A line can only reference a quotation line when the order has a quotationReference (PEPPOL-T01-R035).",
    );
  }
  if (!order.seller.country) {
    throw new UserFacingError("The seller of an order needs a country.");
  }
  if (order.invoicee && !order.invoicee.country) {
    throw new UserFacingError("The invoicee of an order needs a country.");
  }
  if (order.delivery?.locationIdentifier && !order.delivery.location) {
    throw new UserFacingError(
      "A delivery locationIdentifier needs a delivery location: a Peppol order gives every delivery location an address.",
    );
  }
  for (const party of [order.buyer, order.seller, order.invoicee]) {
    if ((party?.partyIdentifiers?.length ?? 0) > 1) {
      throw new UserFacingError("A party in an order can have at most one party identifier.");
    }
  }
}
