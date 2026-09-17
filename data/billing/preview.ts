import { billingProfiles } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import type { SubscriptionBillingLine } from "./billing-types";
import { calculateSubscriptionByMonthlyPeriods, selectBillableSubscriptions } from "./calculate";
import { describeBillingOutcome, summarizeBillingLines, type BillingOutcome } from "./calculation";
import { determineVatStrategy } from "./vat";

export type BillingPreviewOutcome = BillingOutcome;

export type BillingPreview = {
  teamId: string;
  billingDate: string;
  outcome: BillingPreviewOutcome;
  message: string;
  /** Preview only: this call performs no writes, no payments and no invoices. */
  wouldCreateBillingEvent: boolean;
  wouldSendInvoice: boolean;
  wouldRequestPayment: boolean;
  wouldAdvanceLastBilledAt: boolean;
  billingProfile: {
    id: string;
    profileStanding: string;
    isManuallyBilled: boolean;
    isMandateValidated: boolean;
    hasMollieCustomer: boolean;
    companyName: string;
    companyCountry: string;
    companyVatNumber: string | null;
  } | null;
  vat: {
    category: string;
    percentage: number;
    exemptionReason: string | null;
  } | null;
  totals: {
    totalAmountExcl: number;
    vatAmount: number;
    totalAmountIncl: number;
    usedQty: number;
    usedQtyIncoming: number;
    usedQtyOutgoing: number;
    overageQtyIncoming: number;
    overageQtyOutgoing: number;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
  };
  lines: {
    subscriptionId: string;
    planId: string | null;
    planName: string;
    billingPeriodStart: string;
    billingPeriodEnd: string;
    subscriptionStartDate: string;
    subscriptionEndDate: string | null;
    subscriptionLastBilledAt: string | null;
    basePrice: number;
    includedMonthlyDocuments: number;
    incomingDocumentOveragePrice: number;
    outgoingDocumentOveragePrice: number;
    usedQtyIncoming: number;
    usedQtyOutgoing: number;
    overageQtyIncoming: number;
    overageQtyOutgoing: number;
    lineTotalExcl: number;
    lineDescription: string;
  }[];
};

function toPreviewLine(line: SubscriptionBillingLine): BillingPreview["lines"][number] {
  return {
    subscriptionId: line.subscriptionId,
    planId: line.planId,
    planName: line.billingConfig.name,
    billingPeriodStart: line.billingPeriodStart.toISOString(),
    billingPeriodEnd: line.billingPeriodEnd.toISOString(),
    subscriptionStartDate: line.subscriptionStartDate.toISOString(),
    subscriptionEndDate: line.subscriptionEndDate?.toISOString() ?? null,
    subscriptionLastBilledAt: line.subscriptionLastBilledAt,
    basePrice: line.basePrice,
    includedMonthlyDocuments: line.includedMonthlyDocuments,
    incomingDocumentOveragePrice: line.incomingDocumentOveragePrice,
    outgoingDocumentOveragePrice: line.outgoingDocumentOveragePrice,
    usedQtyIncoming: line.usedQtyIncoming,
    usedQtyOutgoing: line.usedQtyOutgoing,
    overageQtyIncoming: line.overageQtyIncoming,
    overageQtyOutgoing: line.overageQtyOutgoing,
    lineTotalExcl: line.lineTotalExcl,
    lineDescription: line.lineDescription,
  };
}

/**
 * Calculate what a team would be billed up to `billingDate`, using exactly the
 * period selection, monthly split and line calculation the billing cycle uses.
 *
 * Strictly read-only: it writes nothing, calls no payment provider, sends no
 * invoice and triggers no notification. Unlike the billing cycle's dry run, it
 * cannot change mandate state or hand a document to the send API.
 */
export async function previewTeamBilling({
  teamId,
  billingDate,
}: {
  teamId: string;
  billingDate: Date;
}): Promise<BillingPreview> {
  const [billingProfile] = await db
    .select()
    .from(billingProfiles)
    .where(eq(billingProfiles.teamId, teamId))
    .limit(1);

  const subscriptions = await selectBillableSubscriptions(billingDate, [teamId]);

  const lines: SubscriptionBillingLine[] = [];
  for (const subscription of subscriptions) {
    lines.push(
      ...(await calculateSubscriptionByMonthlyPeriods({ subscription, billingDate }))
    );
  }

  const vatStrategy = billingProfile ? determineVatStrategy(billingProfile) : null;
  const summary = summarizeBillingLines(lines, vatStrategy?.percentage ?? new Decimal(0));

  const { outcome, message } = describeBillingOutcome({
    profileStanding: billingProfile?.profileStanding ?? null,
    isManuallyBilled: billingProfile?.isManuallyBilled ?? false,
    hasBillingProfile: Boolean(billingProfile),
    hasLines: lines.length > 0,
    totalAmountIncl: summary.totalAmountIncl,
    hasMollieCustomer: Boolean(billingProfile?.mollieCustomerId),
  });

  return {
    teamId,
    billingDate: billingDate.toISOString(),
    outcome,
    message,
    wouldCreateBillingEvent: outcome === "invoice_and_payment",
    wouldSendInvoice: outcome === "invoice_and_payment",
    wouldRequestPayment: outcome === "invoice_and_payment",
    wouldAdvanceLastBilledAt:
      outcome === "invoice_and_payment" ||
      outcome === "manually_billed" ||
      outcome === "marked_billed_only",
    billingProfile: billingProfile
      ? {
          id: billingProfile.id,
          profileStanding: billingProfile.profileStanding,
          isManuallyBilled: billingProfile.isManuallyBilled,
          isMandateValidated: billingProfile.isMandateValidated,
          hasMollieCustomer: Boolean(billingProfile.mollieCustomerId),
          companyName: billingProfile.companyName,
          companyCountry: billingProfile.country,
          companyVatNumber: billingProfile.vatNumber,
        }
      : null,
    vat: vatStrategy
      ? {
          category: vatStrategy.vatCategory,
          percentage: vatStrategy.percentage.toNumber(),
          exemptionReason: vatStrategy.vatExemptionReason,
        }
      : null,
    totals: {
      totalAmountExcl: summary.totalAmountExcl.toNumber(),
      vatAmount: summary.totalVatAmount.toNumber(),
      totalAmountIncl: summary.totalAmountIncl.toNumber(),
      usedQty: summary.usedQty.toNumber(),
      usedQtyIncoming: summary.usedQtyIncoming.toNumber(),
      usedQtyOutgoing: summary.usedQtyOutgoing.toNumber(),
      overageQtyIncoming: summary.overageQtyIncoming.toNumber(),
      overageQtyOutgoing: summary.overageQtyOutgoing.toNumber(),
      billingPeriodStart: summary.billingPeriodStart?.toISOString() ?? null,
      billingPeriodEnd: summary.billingPeriodEnd?.toISOString() ?? null,
    },
    lines: lines.map(toPreviewLine),
  };
}
