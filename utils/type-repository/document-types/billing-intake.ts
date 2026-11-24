import Decimal from "decimal.js";
import type { Finding, Issue } from "@peppol/types/intake";
import { computedLineAmount, lineAmountTolerance } from "@peppol/utils/parsing/invoice/consistency";
import type { DocumentLine } from "@peppol/utils/parsing/invoice/schemas";
import type { AiIntakeRules } from "./types";

// How document intake extracts a billing document from a PDF: the rules every type of
// the billing class shares.

type BillingDocument = {
  lines?: DocumentLine[] | null;
  totals?: {
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

/**
 * Extraction rules for a billing document: the VAT, the amounts and the payment, where
 * models most often put a printed value in the wrong field or leave one out.
 */
const BILLING_INSTRUCTIONS = [
  "Write the VAT rate as a number. When the document prints a VAT code, use the rate that the document gives for that code.",
  "Use VAT category S only with a rate above 0. With rate 0, use the category that the document's VAT text gives: AE for reverse charge (for example Article 196 of Directive 2006/112/EC, \"verlegging\" or \"autoliquidation\"), K for an intra-community supply of goods (Article 138), G for an export outside the EU, E for an exemption that the document states, O for a supply outside the scope of EU VAT, such as a seller outside the EU that charges no VAT, and Z for a 0% rate without any such text.",
  "Copy the VAT text of the document into exemptionReason. Never write an exemption reason that the document does not print.",
  "Always fill the VAT breakdown, also when the document charges no VAT: one entry per VAT category and rate, with its taxable amount.",
  "Line prices and line amounts are without VAT. When the lines show prices with VAT only, derive the amounts without VAT from the printed totals without VAT, or from the printed VAT rate, so that the lines add up to the printed total without VAT, and add an uncertain_value finding.",
  "Copy each total that the document prints as it is printed. Never replace a printed total with the sum of the lines as you read them: when they differ, a line is read wrongly.",
  "Put a charge printed outside the lines, such as shipping, handling or a payment fee, in surcharges, with its VAT category and rate (reasonCode FC for freight). Put a discount printed outside the lines in discounts.",
  "When the document says that it is already paid, for example \"paid with\", \"betaald met\", \"payé par\", by card, by Bancontact or through a marketplace, write the paid amount in totals.paidAmount and the amount still to pay in totals.payableAmount, often 0. An amount that will be debited or collected later is not paid yet. Always fill totals.payableAmount: the total with VAT minus the paid amount.",
  "Set paymentMeans to how the amount is or will be paid. When it is paid or collected by card, by direct debit or through a marketplace, bank details in the letterhead or footer are not a payment instruction: leave that bank account out.",
  "Put the order number of the seller in salesOrderReference and the purchase order number of the buyer in purchaseOrderReference. A customer number that the seller gives the buyer is a party identifier of the buyer; buyerReference is a reference that the buyer gave, such as \"your reference\".",
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
function billingNormalize(document: unknown): unknown {
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
function billingMinimumEvidence(document: unknown): Issue[] {
  const totals = (document as BillingDocument).totals;
  if (decimal(totals?.payableAmount) ?? decimal(totals?.taxInclusiveAmount)) {
    return [];
  }
  return [{ code: "missing_payable_amount", message: "The payable amount is missing.", pointer: "/totals/payableAmount" }];
}

/** The numbers of units a price is commonly printed for: per unit, per 10, per 100 kg, per ton. */
const BASE_QUANTITIES = ["1", "10", "100", "1000"];

function lineMatches(line: DocumentLine) {
  const stated = decimal(line.netAmount);
  const computed = computedLineAmount(line);
  return !!stated && !!computed && stated.minus(computed).abs().lte(lineAmountTolerance(line));
}

/**
 * A line amount that is not its quantity times its price is most often a price for
 * more than one unit, such as a price per ton of a quantity in kg, whose base quantity
 * the model left out or wrote wrongly. When exactly one common base quantity makes the
 * line add up, the line gets it.
 */
function reconcileBaseQuantities(document: unknown): { document: unknown; findings: Finding[] } {
  const billing = document as BillingDocument | null;
  if (!Array.isArray(billing?.lines)) {
    return { document, findings: [] };
  }
  const findings: Finding[] = [];
  const lines = billing.lines.map((line, index) => {
    if (!decimal(line.netAmount) || !computedLineAmount(line) || lineMatches(line)) {
      return line;
    }
    const current = decimal(line.baseQuantity) ?? new Decimal(1);
    const fitting = BASE_QUANTITIES.filter(
      (base) => !current.eq(base) && lineMatches({ ...line, baseQuantity: base }),
    );
    if (fitting.length !== 1) {
      return line;
    }
    const [baseQuantity] = fitting;
    findings.push({
      code: "corrected_value",
      severity: "info",
      scope: "extraction",
      message: `The base quantity is set to ${baseQuantity}: quantity ${line.quantity} × price ${line.netPriceAmount} / ${baseQuantity} gives the printed line amount ${line.netAmount}.`,
      pointer: `/content/lines/${index}/baseQuantity`,
    });
    return { ...line, baseQuantity };
  });
  return findings.length > 0 ? { document: { ...billing, lines }, findings } : { document, findings };
}

/** The VAT categories that have rate 0 in EN 16931; S is the only one with a rate above 0 here. */
const ZERO_RATE_CATEGORIES = new Set(["Z", "E", "AE", "K", "G", "O"]);

type VatOf = { category?: unknown; percentage?: string | null } | null | undefined;

/** A VAT category with a rate it cannot have: S at 0%, or a zero-rate category above 0%. */
function vatCategoryIssue(vat: VatOf, pointer: string): Issue | null {
  const rate = decimal(vat?.percentage);
  if (typeof vat?.category !== "string" || !rate) {
    return null;
  }
  if (vat.category === "S" && rate.isZero()) {
    return {
      code: "vat_category_rate",
      message: "VAT category S needs a rate above 0. Use the category that the document's VAT text gives for a 0% rate.",
      pointer: `${pointer}/category`,
    };
  }
  if (ZERO_RATE_CATEGORIES.has(vat.category) && !rate.isZero()) {
    return {
      code: "vat_category_rate",
      message: `VAT category ${vat.category} has rate 0, but the rate is ${rate.toString()}%.`,
      pointer: `${pointer}/category`,
    };
  }
  return null;
}

/** The amount to pay must be the total with VAT minus what is already paid. */
function payableIssue(document: BillingDocument & { totals?: { paidAmount?: string | null } | null }): Issue | null {
  const totals = document?.totals;
  const payable = decimal(totals?.payableAmount);
  const inclusive = decimal(totals?.taxInclusiveAmount);
  if (!payable || !inclusive) {
    return null;
  }
  const paid = decimal(totals?.paidAmount) ?? new Decimal(0);
  const expected = inclusive.minus(paid);
  if (payable.minus(expected).abs().lte("0.01")) {
    return null;
  }
  return {
    code: "payable_amount",
    message: `The amount to pay is ${payable.toFixed(2)}, but the total with VAT ${inclusive.toFixed(2)} minus the paid amount ${paid.toFixed(2)} gives ${expected.toFixed(2)}. Write a paid amount only when the document says it is paid.`,
    pointer: "/totals/payableAmount",
  };
}

// An amount as a document can print it: with a dot or a comma before the cents, with or
// without a separator between thousands, and without cents when they are 0.
function printedForms(amount: Decimal): string[] {
  const [whole, cents] = amount.abs().toFixed(2).split(".");
  const groupings = [whole, ...[".", ",", " ", " ", "'"].map((separator) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, separator))];
  const forms = new Set<string>();
  for (const grouped of groupings) {
    forms.add(`${grouped}.${cents}`);
    forms.add(`${grouped},${cents}`);
    if (cents === "00") forms.add(grouped);
  }
  return [...forms];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether the text prints the amount as a whole number, not as part of a longer one. */
function textPrints(text: string, amount: Decimal) {
  return printedForms(amount).some((form) =>
    new RegExp(`(?<![\\d.,])${escapeRegExp(form)}(?![\\d]|[.,]\\d)`).test(text),
  );
}

/**
 * The total with VAT, and an amount to pay that differs from it, must be printed in the
 * document: a total that a model computed from lines it misread is printed nowhere. A
 * scanned PDF has no text layer and is not checked.
 */
function unprintedTotalIssues(document: BillingDocument, text: string | undefined): Issue[] {
  if (!text) {
    return [];
  }
  const totals = document?.totals;
  const inclusive = decimal(totals?.taxInclusiveAmount);
  const payable = decimal(totals?.payableAmount);
  const issues: Issue[] = [];
  if (inclusive && !inclusive.isZero() && !textPrints(text, inclusive)) {
    issues.push({
      code: "unprinted_total",
      message: `The total with VAT ${inclusive.toFixed(2)} is not printed in the document. Copy the printed total, and read again the lines that do not add up to it.`,
      pointer: "/totals/taxInclusiveAmount",
    });
  }
  if (payable && !payable.isZero() && !payable.eq(inclusive ?? -1) && !textPrints(text, payable)) {
    issues.push({
      code: "unprinted_total",
      message: `The amount to pay ${payable.toFixed(2)} is not printed in the document.`,
      pointer: "/totals/payableAmount",
    });
  }
  return issues;
}

/**
 * What is wrong in a billing document beyond its arithmetic: VAT categories whose rate
 * contradicts them, an amount to pay that is not the total minus what is paid, and
 * totals that the document does not print.
 */
function billingIssues(document: unknown, context: { text?: string } = {}): Issue[] {
  const totalIssues = [
    payableIssue(document as BillingDocument),
    ...unprintedTotalIssues(document as BillingDocument, context.text),
  ];
  return [...vatCategoryIssues(document), ...totalIssues.filter((issue): issue is Issue => issue !== null)];
}

/** Every VAT category in the document whose rate contradicts it. */
function vatCategoryIssues(document: unknown): Issue[] {
  const billing = document as (BillingDocument & {
    discounts?: { vat?: VatOf }[] | null;
    surcharges?: { vat?: VatOf }[] | null;
  }) | null;
  const issues: (Issue | null)[] = [
    ...(billing?.lines ?? []).map((line, index) => vatCategoryIssue(line.vat as VatOf, `/lines/${index}/vat`)),
    ...(billing?.discounts ?? []).map((discount, index) => vatCategoryIssue(discount.vat, `/discounts/${index}/vat`)),
    ...(billing?.surcharges ?? []).map((surcharge, index) => vatCategoryIssue(surcharge.vat, `/surcharges/${index}/vat`)),
    ...(billing?.vat?.subtotals ?? []).map((subtotal, index) => vatCategoryIssue(subtotal, `/vat/subtotals/${index}`)),
  ];
  return issues.filter((issue): issue is Issue => issue !== null);
}

/** The AI intake rules of every billing type. */
export const billingAiIntake: AiIntakeRules = {
  instructions: BILLING_INSTRUCTIONS,
  normalize: billingNormalize,
  minimumEvidence: billingMinimumEvidence,
  reconcile: reconcileBaseQuantities,
  issues: billingIssues,
};

/** A credit note with negative totals: the document printed them in parentheses or with a minus sign. */
function negativeTotalIssues(document: unknown): Issue[] {
  const inclusive = decimal((document as BillingDocument)?.totals?.taxInclusiveAmount);
  if (!inclusive?.isNegative()) {
    return [];
  }
  return [
    {
      code: "negative_credit_note",
      message:
        "A credit note states the credited amounts as positive numbers, also when the document prints them in parentheses or with a minus sign. Write the quantities, prices and amounts without that sign.",
      pointer: "/totals/taxInclusiveAmount",
    },
  ];
}

/** The AI intake rules of every credit note type: the billing rules, and amounts without the credit sign. */
export const creditNoteAiIntake: AiIntakeRules = {
  ...billingAiIntake,
  instructions: [
    ...BILLING_INSTRUCTIONS,
    "Write the credited quantities, prices and amounts as positive numbers, also when the document prints them in parentheses or with a minus sign.",
  ],
  issues: (document, context) => [...billingIssues(document, context), ...negativeTotalIssues(document)],
};
