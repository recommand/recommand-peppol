import { Decimal } from "decimal.js";
import type { z } from "zod";
import type {
  Invoice,
  DocumentLine,
  VatCategory,
  Totals,
  sendVatTotalsSchema,
} from "./schemas";
import type { CreditNote } from "../creditnote/schemas";
import type { SelfBillingInvoice } from "../self-billing-invoice/schemas";
import type { SelfBillingCreditNote } from "../self-billing-creditnote/schemas";
import { UserFacingError } from "@peppol/utils/util";

type VatCalculationDocument = Pick<
  Invoice,
  "lines" | "discounts" | "surcharges"
> & {
  vat?: z.output<typeof sendVatTotalsSchema> | null;
};

// Vat is always rounded to 2 decimal places per invoice line, discount or surcharge, otherwise we can't guarantee the totals will be correct.

export function calculateLineAmount(line: DocumentLine | DocumentLine) {
  const unitPrice = new Decimal(line.netPriceAmount).div(new Decimal(line.baseQuantity ?? "1"));
  const beforeDiscountsAndSurcharges = new Decimal(line.quantity).mul(unitPrice).toNearest(0.01);

  // Discount totals
  const discountTotalsExcl = line.discounts?.reduce(
    (sum, discount) => sum.plus(discount.amount),
    new Decimal(0)
  ).toNearest(0.01) ?? new Decimal(0);

  // Surcharge totals
  const surchargeTotalsExcl = line.surcharges?.reduce(
    (sum, surcharge) => sum.plus(surcharge.amount),
    new Decimal(0)
  ).toNearest(0.01) ?? new Decimal(0);

  return beforeDiscountsAndSurcharges.minus(discountTotalsExcl).plus(surchargeTotalsExcl).toNearest(0.01).toFixed(2);
}

function getNetAmount(line: DocumentLine | DocumentLine) {
  if (line.netAmount) {
    return line.netAmount;
  }
  return calculateLineAmount(line);
}

export function calculateTotals(document: Invoice | CreditNote | SelfBillingInvoice | SelfBillingCreditNote): Totals {

  // Line totals
  const lineTotalsExcl = document.lines.reduce(
    (sum, line) => sum.plus(getNetAmount(line)),
    new Decimal(0)
  ).toNearest(0.01);

  // Discount totals
  const discountTotalsExcl = document.discounts?.reduce(
    (sum, discount) => sum.plus(discount.amount),
    new Decimal(0)
  ).toNearest(0.01) ?? new Decimal(0);

  // Surcharge totals
  const surchargeTotalsExcl = document.surcharges?.reduce(
    (sum, surcharge) => sum.plus(surcharge.amount),
    new Decimal(0)
  ).toNearest(0.01) ?? new Decimal(0);

  // Vat totals
  const vatTotals = calculateVat({document, isDocumentValidationEnforced: false}); // Do not enforce validation here, as this will fail when subtotals have been provided manually and exemption reasons are required

  // Totals
  const taxExclusiveAmount = new Decimal(lineTotalsExcl).minus(discountTotalsExcl).plus(surchargeTotalsExcl).toNearest(0.01);
  const taxInclusiveAmount = taxExclusiveAmount.plus(new Decimal(vatTotals.totalVatAmount));

  return {
    linesAmount: document.totals?.linesAmount ?? lineTotalsExcl.toFixed(2),
    discountAmount: document.totals?.discountAmount ?? (discountTotalsExcl.eq(0) ? null : discountTotalsExcl.toFixed(2)),
    surchargeAmount: document.totals?.surchargeAmount ?? (surchargeTotalsExcl.eq(0) ? null : surchargeTotalsExcl.toFixed(2)),
    taxExclusiveAmount: document.totals?.taxExclusiveAmount ?? taxExclusiveAmount.toFixed(2),
    taxInclusiveAmount: document.totals?.taxInclusiveAmount ?? taxInclusiveAmount.toFixed(2),
    payableAmount: document.totals?.payableAmount ?? taxInclusiveAmount.toFixed(2),
    paidAmount: document.totals?.paidAmount ?? "0.00",
  };
}

export function extractTotals(totals: Totals): Totals & { paidAmount: string, payableRoundingAmount: string } {
  // Tax exclusive and inclusive amounts are always provided
  const taxExclusiveAmount = new Decimal(totals.taxExclusiveAmount).toNearest(0.01);
  const taxInclusiveAmount = new Decimal(totals.taxInclusiveAmount).toNearest(0.01);

  // Payable amount and paid amount are optional
  let payableAmountStr = totals.payableAmount ?? null;
  let paidAmountStr = totals.paidAmount ?? null;

  let payableAmount = new Decimal(0);
  let paidAmount = new Decimal(0);

  if(payableAmountStr) {
    // Payable amount is provided
    payableAmount = new Decimal(payableAmountStr).toNearest(0.01);
    if(paidAmountStr) {
      // Paid amount is provided
      paidAmount = new Decimal(paidAmountStr).toNearest(0.01);
    } else {
      // Paid amount is not provided, so we can calculate it from the totals
      if(payableAmount.gt(taxInclusiveAmount)) {
        paidAmount = new Decimal(0);
      }else{
        paidAmount = taxInclusiveAmount.minus(payableAmount).toNearest(0.01);
      }
    }
  }else{
    // Payable amount is not provided, so we have to calculate it from the totals
    if(paidAmountStr) {
      // Paid amount is provided
      paidAmount = new Decimal(paidAmountStr).toNearest(0.01);
    } else {
      // Paid amount is not provided, we assume it to be 0
      paidAmount = new Decimal(0);
    }
    payableAmount = paidAmount.gt(taxInclusiveAmount) ? new Decimal(0) : taxInclusiveAmount.minus(paidAmount).toNearest(0.01);
  }

  // Calculate payable rounding amount
  const payableRoundingAmount = payableAmount.plus(paidAmount).minus(taxInclusiveAmount).toNearest(0.01);

  return {
    linesAmount: totals.linesAmount,
    discountAmount: totals.discountAmount,
    surchargeAmount: totals.surchargeAmount,
    taxExclusiveAmount: taxExclusiveAmount.toNearest(0.01).toFixed(2),
    taxInclusiveAmount: taxInclusiveAmount.toNearest(0.01).toFixed(2),
    payableAmount: payableAmount.toNearest(0.01).toFixed(2),
    paidAmount: paidAmount.toNearest(0.01).toFixed(2),
    payableRoundingAmount: payableRoundingAmount.toNearest(0.01).toFixed(2),
  };
  
}

export function calculateVat({document, isDocumentValidationEnforced}: {document: VatCalculationDocument, isDocumentValidationEnforced: boolean}) {

  const getKey = (category: VatCategory, percentage: string) => `${category}-${percentage}`;

  // Collect all vat categories and percentages
  const vatInfo = new Set<{ category: VatCategory; percentage: string }>();
  for(const line of document.lines) {
    vatInfo.add({ category: line.vat.category, percentage: line.vat.percentage });
  }
  for(const discount of document.discounts ?? []) {
    vatInfo.add({ category: discount.vat.category, percentage: discount.vat.percentage });
  }
  for(const surcharge of document.surcharges ?? []) {
    vatInfo.add({ category: surcharge.vat.category, percentage: surcharge.vat.percentage });
  }

  const subtotalsByKey = new Map<string, { taxableAmount: Decimal; category: VatCategory; percentage: string }>();

  const addToSubtotals = (category: VatCategory, percentage: string, taxableAmount: Decimal) => {
    const key = getKey(category, new Decimal(percentage).toString());
    if (!subtotalsByKey.has(key)) {
      subtotalsByKey.set(key, { taxableAmount: new Decimal(0), category: category, percentage: percentage });
    }
    subtotalsByKey.get(key)!.taxableAmount = subtotalsByKey.get(key)!.taxableAmount.plus(taxableAmount);
  }

  // Add invoice lines
  for(const line of document.lines) {
    const taxableAmount = new Decimal(getNetAmount(line));
    addToSubtotals(line.vat.category, line.vat.percentage, taxableAmount);
  }

  // Add global discounts
  for(const discount of document.discounts ?? []) {
    const taxableAmount = new Decimal(discount.amount);
    addToSubtotals(discount.vat.category, discount.vat.percentage, taxableAmount.neg());
  }

  // Add global surcharges
  for(const surcharge of document.surcharges ?? []) {
    const taxableAmount = new Decimal(surcharge.amount);
    addToSubtotals(surcharge.vat.category, surcharge.vat.percentage, taxableAmount);
  }

  // Add exemption reason if required
  const exemptionReasonCode: null | string = (document.vat && "exemptionReasonCode" in document.vat && document.vat.exemptionReasonCode) ? (document.vat.exemptionReasonCode as string) : null;
  const exemptionReason: null | string = (document.vat && "exemptionReason" in document.vat && document.vat.exemptionReason) ? (document.vat.exemptionReason as string) : null;

  const subtotals = Array.from(subtotalsByKey.values()).map(subtotal => {

    let subtotalExemptionReasonCode: null | string = null;
    let subtotalExemptionReason: null | string = null;
    if(isTaxExemptionReasonRequired(subtotal.category)) {
      if(exemptionReasonCode || exemptionReason) {
        subtotalExemptionReasonCode = exemptionReasonCode;
        subtotalExemptionReason = exemptionReason;
      }else if(isDocumentValidationEnforced){
        throw new UserFacingError("Exemption reason code or reason is required for tax category " + subtotal.category);
      }
    }

    return {
      taxableAmount: subtotal.taxableAmount.toNearest(0.01).toFixed(2),
      vatAmount: subtotal.taxableAmount.mul(subtotal.percentage).div(100).toNearest(0.01).toFixed(2),
      category: subtotal.category,
      percentage: subtotal.percentage,
      exemptionReasonCode: subtotalExemptionReasonCode,
      exemptionReason: subtotalExemptionReason,
    };
  });

  const totalVatAmount = subtotals.reduce(
    (sum, subtotal) => sum.plus(new Decimal(subtotal.vatAmount)),
    new Decimal(0)
  ).toNearest(0.01).toFixed(2);

  return { totalVatAmount, subtotals };
} 

export function resolveVatTotals({
  document,
  isDocumentValidationEnforced,
}: {
  document: VatCalculationDocument;
  isDocumentValidationEnforced: boolean;
}) {
  return document.vat &&
    "subtotals" in document.vat &&
    "totalVatAmount" in document.vat
    ? document.vat
    : calculateVat({ document, isDocumentValidationEnforced });
}

// Calculates the totals at every level of a document: the net amount per line,
// the VAT subtotals/total, and the extracted document-level monetary totals.
export function calculateDocumentTotals({
  document,
  isDocumentValidationEnforced,
}: {
  document: Invoice | CreditNote;
  isDocumentValidationEnforced: boolean;
}) {
  const totals = calculateTotals(document);
  const vat = resolveVatTotals({ document, isDocumentValidationEnforced });
  const lines = document.lines.map((line) => ({
    ...line,
    netAmount: line.netAmount || calculateLineAmount(line),
  }));
  const extractedTotals = extractTotals(totals);

  return { vat, lines, extractedTotals };
}

export function isTaxExemptionReasonRequired(category: VatCategory): boolean {
  // AE: VAT reverse charge
  // E: Exempt from VAT
  // G: Export outside EU
  // O: Not subject to VAT
  // K: Intra-community supply
  return ["AE", "E", "G", "O", "K"].includes(category);
}
