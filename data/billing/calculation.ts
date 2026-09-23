import {
  addMilliseconds,
  differenceInMinutes,
  endOfMonth,
  formatISO,
  isSameDay,
  startOfMonth,
} from "date-fns";
import { TZDate } from "@date-fns/tz";
import Decimal from "decimal.js";
import type { subscriptions } from "@peppol/db/schema";
import { BillingConfigSchema } from "../plans";
import type { SubscriptionBillingLine } from "./billing-types";

export type Subscription = typeof subscriptions.$inferSelect;

export type CompanyUsageRow = {
  companyId: string | null;
  companyName: string | null;
  usage: number;
};

export type SubscriptionUsage = {
  usageBeforeSubscriptionStart: number;
  incomingByCompany: CompanyUsageRow[];
  outgoingByCompany: CompanyUsageRow[];
};

export type BillingPeriodMonth = {
  startOfPeriodInclusive: Date;
  startInclusive: Date;
  endInclusive: Date;
};

/**
 * Split the unbilled span of a subscription into calendar months (UTC): [start of
 * the unbilled span, end of that month], [start of month 2, end of month 2], ...,
 * [start of the last month, end of the unbilled span].
 */
export function splitBillingPeriodIntoMonths(
  subscription: Subscription,
  billingDate: Date
): BillingPeriodMonth[] {
  const subscriptionHasEnded =
    (subscription.endDate && subscription.endDate < billingDate) ?? false;
  const billingPeriodStartInclusive = addMilliseconds(
    TZDate.tz("UTC", subscription.lastBilledAt || subscription.startDate),
    1
  );
  const billingPeriodEndInclusive = TZDate.tz(
    "UTC",
    subscriptionHasEnded ? subscription.endDate! : billingDate
  );

  if (billingPeriodStartInclusive > billingPeriodEndInclusive) {
    throw new Error(
      `Billing period start is after billing period end for subscription ${subscription.id}`
    );
  }

  const billingPeriodMonths: BillingPeriodMonth[] = [];
  let nextStart = billingPeriodStartInclusive;
  while (nextStart <= billingPeriodEndInclusive) {
    const startOfPeriodInclusive = startOfMonth(nextStart);
    let endOfPeriod = endOfMonth(nextStart);
    if (endOfPeriod > billingPeriodEndInclusive) {
      endOfPeriod = billingPeriodEndInclusive;
    }
    billingPeriodMonths.push({
      startOfPeriodInclusive,
      startInclusive: nextStart,
      endInclusive: endOfPeriod,
    });
    nextStart = addMilliseconds(endOfPeriod, 1);
  }

  return billingPeriodMonths;
}

/**
 * Turn one subscription month plus its usage into an invoice line. Pure: the same
 * function produces the billed line and the previewed line.
 */
export function computeSubscriptionBillingLine({
  subscription,
  startInclusive,
  endInclusive,
  usage,
}: {
  subscription: Subscription;
  startInclusive: Date;
  endInclusive: Date;
  usage: SubscriptionUsage;
}): SubscriptionBillingLine {
  // Validate billing config
  if (!subscription.billingConfig) {
    throw new Error(
      `Billing config is missing for subscription ${subscription.id}`
    );
  }
  if (typeof subscription.billingConfig.basePrice !== "number") {
    throw new Error(
      `Invalid basePrice in billing config for subscription ${subscription.id}`
    );
  }
  if (typeof subscription.billingConfig.includedMonthlyDocuments !== "number") {
    throw new Error(
      `Invalid includedMonthlyDocuments in billing config for subscription ${subscription.id}`
    );
  }
  if (typeof subscription.billingConfig.documentOveragePrice !== "number") {
    throw new Error(
      `Invalid documentOveragePrice in billing config for subscription ${subscription.id}`
    );
  }

  const billingConfigCheck = BillingConfigSchema.safeParse(
    subscription.billingConfig
  );
  if (!billingConfigCheck.success) {
    throw new Error(
      `Invalid billing config for subscription ${subscription.id}: ${billingConfigCheck.error.message}`
    );
  }
  const billingConfig = billingConfigCheck.data;

  // If the start is the first day of the month, and the end is the last day of the month, it's a full month
  const isEntireMonth =
    isSameDay(startInclusive, startOfMonth(startInclusive)) &&
    isSameDay(endInclusive, endOfMonth(endInclusive));

  // The allowance is not pro rata, but usage already billed this month is deducted
  const includedUsage = Math.max(
    billingConfig.includedMonthlyDocuments - usage.usageBeforeSubscriptionStart,
    0
  );
  const minutesInPeriod = differenceInMinutes(endInclusive, startInclusive);
  const monthlyMinutes = new Decimal(31).times(24).times(60); // 31 days * 24 hours * 60 minutes
  let billingRatio = new Decimal(minutesInPeriod).div(monthlyMinutes);
  if (isEntireMonth || billingRatio.gt(1)) {
    billingRatio = new Decimal(1);
  }

  let incomingUsageDecimal = new Decimal(0);
  let outgoingUsageDecimal = new Decimal(0);
  const perCompanyUsage: Record<
    string,
    { companyName: string; incomingUsage: Decimal; outgoingUsage: Decimal }
  > = {};
  const ensureCompany = (row: CompanyUsageRow) => {
    const key = row.companyId ?? "unknown";
    if (!perCompanyUsage[key]) {
      perCompanyUsage[key] = {
        companyName: row.companyName ?? "Deleted companies",
        incomingUsage: new Decimal(0),
        outgoingUsage: new Decimal(0),
      };
    }
    return perCompanyUsage[key];
  };
  for (const company of usage.incomingByCompany) {
    const entry = ensureCompany(company);
    entry.incomingUsage = entry.incomingUsage.plus(company.usage);
    incomingUsageDecimal = incomingUsageDecimal.plus(company.usage);
  }
  for (const company of usage.outgoingByCompany) {
    const entry = ensureCompany(company);
    entry.outgoingUsage = entry.outgoingUsage.plus(company.usage);
    outgoingUsageDecimal = outgoingUsageDecimal.plus(company.usage);
  }

  const usageDecimal = incomingUsageDecimal.plus(outgoingUsageDecimal);

  // Calculate billing amount
  const baseAmount = new Decimal(billingConfig.basePrice).times(billingRatio);

  const incomingDocumentOveragePrice =
    billingConfig.incomingDocumentOveragePrice !== undefined
      ? billingConfig.incomingDocumentOveragePrice
      : billingConfig.documentOveragePrice;
  const outgoingDocumentOveragePrice =
    billingConfig.outgoingDocumentOveragePrice !== undefined
      ? billingConfig.outgoingDocumentOveragePrice
      : billingConfig.documentOveragePrice;

  // We have to determine how many documents have to be billed for the overage
  let toBeBilledIncoming: Decimal = incomingUsageDecimal;
  let toBeBilledOutgoing: Decimal = outgoingUsageDecimal;
  // First subtract from the incoming documents
  let remainingIncludedUsage = new Decimal(includedUsage);
  if (incomingUsageDecimal.gt(remainingIncludedUsage)) {
    toBeBilledIncoming = incomingUsageDecimal.minus(remainingIncludedUsage);
    remainingIncludedUsage = new Decimal(0);
  } else {
    toBeBilledIncoming = new Decimal(0);
    remainingIncludedUsage = remainingIncludedUsage.minus(incomingUsageDecimal);
  }
  // Then subtract from the outgoing documents
  if (outgoingUsageDecimal.gt(remainingIncludedUsage)) {
    toBeBilledOutgoing = outgoingUsageDecimal.minus(remainingIncludedUsage);
    remainingIncludedUsage = new Decimal(0);
  } else {
    toBeBilledOutgoing = new Decimal(0);
    remainingIncludedUsage = remainingIncludedUsage.minus(outgoingUsageDecimal);
  }

  const overageAmountExcl = toBeBilledIncoming
    .times(incomingDocumentOveragePrice)
    .plus(toBeBilledOutgoing.times(outgoingDocumentOveragePrice));

  // Add the base amount and the overage amount
  let totalAmountExcl = baseAmount.plus(overageAmountExcl).toNearest(0.01);

  // If a minimum price is set, and the total amount is less than the minimum price, set the total amount to the minimum price
  let minimumPrice: Decimal | null = null;
  if (
    "minimumPrice" in billingConfig &&
    billingConfig.minimumPrice &&
    billingConfig.minimumPrice > 0
  ) {
    minimumPrice = new Decimal(billingConfig.minimumPrice).times(billingRatio);
    totalAmountExcl = Decimal.max(totalAmountExcl, minimumPrice).toNearest(0.01);
  }

  // Generate description for invoice line
  let lineDescription = `${formatISO(startInclusive, { representation: "date" })} - ${formatISO(endInclusive, { representation: "date" })}\n\n`;
  lineDescription += `Incoming: ${incomingUsageDecimal.toString()} documents\n`;
  lineDescription += `Outgoing: ${outgoingUsageDecimal.toString()} documents\n`;
  lineDescription += `Included in subscription: ${includedUsage} documents\n`;
  lineDescription += `Base price: € ${baseAmount.toNearest(0.01).toString()}\n`;
  if (minimumPrice) {
    lineDescription += `Minimum price: € ${minimumPrice.toNearest(0.01).toString()}\n`;
  }
  lineDescription += `Overage: ${toBeBilledIncoming.toString()} in, ${toBeBilledOutgoing.toString()} out\n`;
  lineDescription += `Overage price per document: € ${incomingDocumentOveragePrice.toString()} in, € ${outgoingDocumentOveragePrice.toString()} out\n`;
  lineDescription += `\n`;
  lineDescription += `Per company usage:\n`;
  // Add document usage per company
  for (const companyId in perCompanyUsage) {
    const company = perCompanyUsage[companyId];
    lineDescription += `- ${company.companyName}: ${company.incomingUsage.toString()} in, ${company.outgoingUsage.toString()} out\n`;
  }

  return {
    subscriptionId: subscription.id,
    billingConfig: subscription.billingConfig,
    subscriptionStartDate: subscription.startDate,
    subscriptionEndDate: subscription.endDate,
    billingPeriodStart: startInclusive,
    billingPeriodEnd: endInclusive,
    subscriptionLastBilledAt: subscription.lastBilledAt?.toISOString() ?? null,
    planId: subscription.planId,
    includedMonthlyDocuments: billingConfig.includedMonthlyDocuments,
    basePrice: billingConfig.basePrice,
    incomingDocumentOveragePrice,
    outgoingDocumentOveragePrice,

    // Invoice line
    lineName: "Recommand " + billingConfig.name,
    lineDescription: lineDescription,
    lineTotalExcl: totalAmountExcl.toNumber(),
    usedQty: usageDecimal.toNumber(),
    usedQtyIncoming: incomingUsageDecimal.toNumber(),
    usedQtyOutgoing: outgoingUsageDecimal.toNumber(),
    overageQtyIncoming: toBeBilledIncoming.toNumber(),
    overageQtyOutgoing: toBeBilledOutgoing.toNumber(),
  };
}

export type BillingLineSummary = {
  totalAmountExcl: Decimal;
  totalVatAmount: Decimal;
  totalAmountIncl: Decimal;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  usedQty: Decimal;
  usedQtyIncoming: Decimal;
  usedQtyOutgoing: Decimal;
  overageQtyIncoming: Decimal;
  overageQtyOutgoing: Decimal;
};

/**
 * Aggregate invoice lines into the totals an invoice and its preview share.
 */
export function summarizeBillingLines(
  billingLines: SubscriptionBillingLine[],
  vatPercentage: Decimal
): BillingLineSummary {
  const totalAmountExcl = billingLines
    .reduce((acc, curr) => acc.plus(curr.lineTotalExcl), new Decimal(0))
    .toNearest(0.01);
  const totalVatAmount = totalAmountExcl
    .times(vatPercentage)
    .div(100)
    .toNearest(0.01);
  const totalAmountIncl = totalAmountExcl.plus(totalVatAmount).toNearest(0.01);

  let billingPeriodStart: Date | null = null;
  let billingPeriodEnd: Date | null = null;
  for (const result of billingLines) {
    if (!billingPeriodStart || result.billingPeriodStart < billingPeriodStart) {
      billingPeriodStart = result.billingPeriodStart;
    }
    if (
      !billingPeriodEnd ||
      (result.billingPeriodEnd && billingPeriodEnd && result.billingPeriodEnd > billingPeriodEnd)
    ) {
      billingPeriodEnd = result.billingPeriodEnd;
    }
  }

  let usedQty = new Decimal(0);
  let usedQtyIncoming = new Decimal(0);
  let usedQtyOutgoing = new Decimal(0);
  let overageQtyIncoming = new Decimal(0);
  let overageQtyOutgoing = new Decimal(0);
  for (const result of billingLines) {
    usedQty = usedQty.plus(result.usedQty);
    usedQtyIncoming = usedQtyIncoming.plus(result.usedQtyIncoming);
    usedQtyOutgoing = usedQtyOutgoing.plus(result.usedQtyOutgoing);
    overageQtyIncoming = overageQtyIncoming.plus(result.overageQtyIncoming);
    overageQtyOutgoing = overageQtyOutgoing.plus(result.overageQtyOutgoing);
  }

  return {
    totalAmountExcl,
    totalVatAmount,
    totalAmountIncl,
    billingPeriodStart,
    billingPeriodEnd,
    usedQty,
    usedQtyIncoming,
    usedQtyOutgoing,
    overageQtyIncoming,
    overageQtyOutgoing,
  };
}

/**
 * What the billing cycle would do with a team's totals, mirroring the rules in
 * `billTeam`.
 */
export type BillingOutcome =
  | "skipped_no_billing_profile"
  | "skipped_pending_profile"
  | "nothing_to_bill"
  | "marked_billed_only"
  | "manually_billed"
  | "blocked_no_payment_customer"
  | "invoice_and_payment";

/**
 * Decide the outcome a real billing run would reach, from the same facts. The
 * billing cycle branches on this decision too, so a preview cannot drift from it.
 */
export function describeBillingOutcome({
  profileStanding,
  isManuallyBilled,
  hasBillingProfile,
  hasLines,
  totalAmountIncl,
  hasMollieCustomer,
}: {
  profileStanding: string | null;
  isManuallyBilled: boolean;
  hasBillingProfile: boolean;
  hasLines: boolean;
  totalAmountIncl: Decimal;
  hasMollieCustomer: boolean;
}): { outcome: BillingOutcome; message: string } {
  if (!hasBillingProfile) {
    return {
      outcome: "skipped_no_billing_profile",
      message: "The team has no billing profile, so the billing cycle reports an error for it.",
    };
  }
  if (profileStanding === "pending") {
    return {
      outcome: "skipped_pending_profile",
      message: "The billing profile is pending, so the billing cycle skips this team.",
    };
  }
  if (!hasLines) {
    return {
      outcome: "nothing_to_bill",
      message: "No subscription period is due for billing on this date.",
    };
  }
  if (totalAmountIncl.eq(0)) {
    return {
      outcome: "marked_billed_only",
      message: "The total is \u20ac 0, so the cycle only moves lastBilledAt forward: no invoice and no payment.",
    };
  }
  if (isManuallyBilled) {
    return {
      outcome: "manually_billed",
      message: "The profile is billed manually, so the cycle moves lastBilledAt forward without creating a billing event, invoice or payment.",
    };
  }
  if (!hasMollieCustomer) {
    return {
      outcome: "blocked_no_payment_customer",
      message: "The billing profile has no Mollie customer, so the cycle stops with an error for this team: no billing event, no invoice, no payment, and lastBilledAt does not move.",
    };
  }
  return {
    outcome: "invoice_and_payment",
    message: "The cycle would create a billing event, send the invoice and request payment.",
  };
}
