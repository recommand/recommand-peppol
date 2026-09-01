import { billingProfiles, subscriptionBillingEventLines, subscriptionBillingEvents, subscriptions, transferEvents } from "@peppol/db/schema";
import { companies } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, eq, isNull, lt, or, gt, count, gte, lte, inArray, max } from "drizzle-orm";
import {
  differenceInMinutes,
  isSameDay,
  startOfMonth,
  addMilliseconds,
  endOfMonth,
  formatISO,
} from "date-fns";
import Decimal from "decimal.js";
import { getBillingProfile } from "../billing-profile";
import { getMandate, requestPayment } from "../mollie";
import { sendTelegramNotification } from "@peppol/utils/system-notifications/telegram";
import { BillingConfigSchema } from "../plans";
import type { Mandate } from "@mollie/api-client";
import { type SubscriptionBillingLine, type TeamBillingResult, TeamBillingResultError, ERROR_TEAM_BILLING_RESULT } from "./billing-types";
import { generateTeamBillingResult } from "./helpers";
import { determineVatStrategy } from "./vat";
import { sendInvoiceAsBRBX } from "./invoicing";
import { TZDate } from '@date-fns/tz'

export async function endBillingCycle(billingDate: Date, dryRun: boolean = false, teamIds?: string[]): Promise<TeamBillingResult[]> {
  const toBeBilled = await db
    .select()
    .from(subscriptions)
    .innerJoin(billingProfiles, eq(subscriptions.teamId, billingProfiles.teamId))
    .where(
      and(
        (teamIds && teamIds.length > 0) ? inArray(subscriptions.teamId, teamIds) : undefined,
        lt(subscriptions.startDate, billingDate),
        or(
          isNull(subscriptions.lastBilledAt), // Subscription has not been billed yet
          lt(subscriptions.lastBilledAt, billingDate) // Subscription has been billed, but should be billed again
        ),
        or(
          isNull(subscriptions.endDate), // Subscription is still active
          isNull(subscriptions.lastBilledAt), // Subscription has not been billed yet
          gt(subscriptions.endDate, subscriptions.lastBilledAt) // Subscription has been ended, but not fully billed yet
        )
      )
    )
    .orderBy(subscriptions.teamId, subscriptions.startDate);

  const groupedByTeam = toBeBilled.reduce((acc, row) => {
    const subscription = row.peppol_subscriptions
    acc[subscription.teamId] = [...(acc[subscription.teamId] || []), subscription];
    return acc;
  }, {} as Record<string, typeof subscriptions.$inferSelect[]>);

  const results: TeamBillingResult[] = [];
  for (const teamId in groupedByTeam) {
    try {
      const result = await billTeam({
        teamId: teamId,
        toBeBilledSubscriptions: groupedByTeam[teamId],
        billingDate: billingDate,
        dryRun: dryRun,
      });
      results.push(...result);
    } catch (error) {
      console.error(
        `Error ending billing cycle for team ${teamId}: ${error}`
      );
      sendTelegramNotification(`Error billing team ${teamId}: ${error}`);
      if (error instanceof TeamBillingResultError) {
        results.push(...error.teamBillingResult.map(x => ({
          ...x,
          teamId,
          billingDate: billingDate.toISOString(),
        })));
      } else {
        results.push({
          ...ERROR_TEAM_BILLING_RESULT,
          message: error?.toString() ?? "Unknown error",
          teamId,
          billingDate: billingDate.toISOString(),
        });
      }
    }
  }
  return results;
}

async function billTeam({
  teamId,
  toBeBilledSubscriptions,
  billingDate,
  dryRun = false,
}: {
  teamId: string;
  toBeBilledSubscriptions: typeof subscriptions.$inferSelect[];
  billingDate: Date;
  dryRun?: boolean;
}): Promise<TeamBillingResult[]> {

  let invoiceReference: number | null = null;
  let billingEventId: string | null = null;
  let isPaymentRequested: boolean = false;
  let invoiceId: string | null = null;

  try {

    // Get billing profile for team
    const billingProfile = await getBillingProfile(teamId);

    if (!billingProfile) {
      throw new TeamBillingResultError(
        `Billing profile not found`,
        [{ isInvoiceSent: "", isPaymentRequested: "" }]
      );
    }

    // Skip pending billing profiles
    if (billingProfile.profileStanding === "pending") {
      // TODO: later on, we should just silently skip the billing cycle for this team (return empty array), as these teams have never properly setup their billing profile
      throw new TeamBillingResultError(
        `Billing profile is pending`,
        [{
          billingProfileId: billingProfile.id,
          billingProfileStanding: billingProfile.profileStanding,
          isManuallyBilled: billingProfile.isManuallyBilled,
          companyName: billingProfile.companyName,
          companyStreet: billingProfile.address,
          companyPostalCode: billingProfile.postalCode,
          companyCity: billingProfile.city,
          companyCountry: billingProfile.country,
          companyVatNumber: billingProfile.vatNumber,
          isInvoiceSent: "", 
          isPaymentRequested: "",
        }]
      );
    }

    // Bill each subscription
    const billingLines: SubscriptionBillingLine[] = [];
    for (const subscription of toBeBilledSubscriptions) {
      billingLines.push(...await calculateSubscriptionByMonthlyPeriods({
        subscription,
        billingDate,
      }));
    }

    // Determine VAT strategy
    const vatStrategy = determineVatStrategy(billingProfile);

    // Calculate totals
    const totalAmountExcl = billingLines.reduce((acc, curr) => acc.plus(curr.lineTotalExcl), new Decimal(0)).toNearest(0.01);
    const totalVatAmount = totalAmountExcl.times(vatStrategy.percentage).div(100).toNearest(0.01);
    const totalAmountIncl = totalAmountExcl.plus(totalVatAmount).toNearest(0.01);

    // Determine billing period
    let billingPeriodStart: Date | null = null;
    let billingPeriodEnd: Date | null = null;
    for (const result of billingLines) {
      if (!billingPeriodStart || result.billingPeriodStart < billingPeriodStart) {
        billingPeriodStart = result.billingPeriodStart;
      }
      if (!billingPeriodEnd || result.billingPeriodEnd && billingPeriodEnd && result.billingPeriodEnd > billingPeriodEnd) {
        billingPeriodEnd = result.billingPeriodEnd;
      }
    }

    if (!billingPeriodStart) {
      throw new TeamBillingResultError(
        `Billing period start is not set`,
        [{ isInvoiceSent: "", isPaymentRequested: "" }]
      );
    }

    if (!billingPeriodEnd) {
      billingPeriodEnd = billingDate;
    }

    // Gather usage totals
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

    // If total amount incl == 0, mark as billed
    if (totalAmountIncl.eq(0)) {
      if (!dryRun) {
        await db
          .update(subscriptions)
          .set({ lastBilledAt: billingDate })
          .where(inArray(subscriptions.id, toBeBilledSubscriptions.map(subscription => subscription.id)));
      }

      return billingLines.map((x, i) => ({
        ...generateTeamBillingResult(x, billingProfile),
        status: "success",
        isInvoiceSent: "",
        isPaymentRequested: "",
        message: "",
        billingProfileId: billingProfile.id,
        billingProfileStanding: billingProfile.profileStanding,
        isManuallyBilled: billingProfile.isManuallyBilled,
        teamId: teamId,
        companyName: billingProfile.companyName,
        companyStreet: billingProfile.address,
        companyPostalCode: billingProfile.postalCode,
        companyCity: billingProfile.city,
        companyCountry: billingProfile.country,
        companyVatNumber: billingProfile.vatNumber,
        billingEventId: billingEventId,
        invoiceId: invoiceId,
        invoiceReference: invoiceReference,
        totalAmountExcl: i === 0 ? totalAmountExcl.toNumber() : null,
        vatCategory: vatStrategy.vatCategory,
        vatPercentage: vatStrategy.percentage.toNumber(),
        vatExemptionReason: vatStrategy.vatExemptionReason,
        vatAmount: i === 0 ? totalVatAmount.toNumber() : null,
        totalAmountIncl: i === 0 ? totalAmountIncl.toNumber() : null,
        billingDate: billingDate.toISOString(),
      }));
    }

    if (!billingProfile.isManuallyBilled) {
      // Get the customer mandate
      if (!billingProfile.mollieCustomerId) {
        throw new TeamBillingResultError(
          "Billing profile has no Mollie customer id",
          billingLines.map(x => generateTeamBillingResult(x, billingProfile, { isInvoiceSent: "", isPaymentRequested: "" }))
        );
      }
      let mandate: Mandate | null = null;
      try {
        mandate = await getMandate(billingProfile.mollieCustomerId);
      } catch (error) {
        console.error(`Error getting mandate for billing profile ${billingProfile.id}: ${error}`);
      }
      if (!mandate) {
        // Update billing profile mandate status
        await db
          .update(billingProfiles)
          .set({
            isMandateValidated: false,
          })
          .where(eq(billingProfiles.id, billingProfile.id));
      }

      // Create billing event
      if (!dryRun) {
        await db.transaction(async (tx) => {

          // Find the next invoice reference
          const highestInvoiceReference = await tx
            .select({ invoiceReference: max(subscriptionBillingEvents.invoiceReference) })
            .from(subscriptionBillingEvents);
          let nextInvoiceReference = 5000;
          if (highestInvoiceReference.length > 0) {
            nextInvoiceReference = (highestInvoiceReference[0].invoiceReference ?? nextInvoiceReference) + 1;
          }
          invoiceReference = nextInvoiceReference;

          // Create billing event
          const [{ id: _billingEventId }] = await tx
            .insert(subscriptionBillingEvents)
            .values({
              teamId,
              billingProfileId: billingProfile.id,
              billingDate: billingDate,
              billingPeriodStart,
              billingPeriodEnd,
              totalAmountExcl: totalAmountExcl.toFixed(2),
              vatAmount: totalVatAmount.toFixed(2),
              vatCategory: vatStrategy.vatCategory,
              vatPercentage: vatStrategy.percentage.toFixed(2),
              totalAmountIncl: totalAmountIncl.toFixed(2),
              usedQty: usedQty.toFixed(2),
              usedQtyIncoming: usedQtyIncoming.toFixed(2),
              usedQtyOutgoing: usedQtyOutgoing.toFixed(2),
              overageQtyIncoming: overageQtyIncoming.toFixed(2),
              overageQtyOutgoing: overageQtyOutgoing.toFixed(2),
              amountDue: totalAmountIncl.toFixed(2),
              paymentStatus: totalAmountIncl.gt(0) ? "none" : "paid",
              paymentId: null,
              paidAmount: totalAmountIncl.gt(0) ? null : new Decimal(0).toFixed(2),
              paymentMethod: totalAmountIncl.gt(0) ? null : "auto-reconcile",
              paymentDate: totalAmountIncl.gt(0) ? null : new Date(),
              invoiceReference,
            })
            .returning({ id: subscriptionBillingEvents.id });
          billingEventId = _billingEventId;

          if (!billingEventId) {
            throw new TeamBillingResultError(
              `Failed to create billing event`,
              billingLines.map(x => generateTeamBillingResult(x, billingProfile, { isInvoiceSent: "", isPaymentRequested: "" }))
            );
          }

          // Create billing event lines
          for (const result of billingLines) {
            await tx
              .insert(subscriptionBillingEventLines)
              .values({
                subscriptionBillingEventId: billingEventId!,
                subscriptionId: result.subscriptionId,
                billingConfig: result.billingConfig,
                subscriptionStartDate: result.subscriptionStartDate,
                subscriptionEndDate: result.subscriptionEndDate ?? billingPeriodEnd,
                subscriptionLastBilledAt: result.subscriptionLastBilledAt ? new Date(result.subscriptionLastBilledAt) : billingPeriodStart,
                planId: result.planId,
                includedMonthlyDocuments: result.includedMonthlyDocuments.toFixed(2),
                basePrice: result.basePrice.toFixed(2),
                incomingDocumentOveragePrice: result.incomingDocumentOveragePrice.toFixed(2),
                outgoingDocumentOveragePrice: result.outgoingDocumentOveragePrice.toFixed(2),
                usedQty: result.usedQty.toFixed(2),
                usedQtyIncoming: result.usedQtyIncoming.toFixed(2),
                usedQtyOutgoing: result.usedQtyOutgoing.toFixed(2),
                overageQtyIncoming: result.overageQtyIncoming.toFixed(2),
                overageQtyOutgoing: result.overageQtyOutgoing.toFixed(2),
                name: result.lineName,
                description: result.lineDescription,
                totalAmountExcl: result.lineTotalExcl.toFixed(2),
              });
          }
        });
      }

      // Create invoice for team
      try {
        invoiceId = await sendInvoiceAsBRBX({
          issueDate: billingDate,
          teamId: teamId,
          companyName: billingProfile.companyName,
          companyStreet: billingProfile.address,
          companyPostalCode: billingProfile.postalCode,
          companyCity: billingProfile.city,
          companyCountry: billingProfile.country,
          companyVatNumber: billingProfile.vatNumber ?? null,
          invoiceReference: invoiceReference,
          totalAmountExcl: totalAmountExcl.toNumber(),
          totalVatAmount: totalVatAmount.toNumber(),
          vatCategory: vatStrategy.vatCategory,
          vatPercentage: vatStrategy.percentage.toNumber(),
          vatExemptionReason: vatStrategy.vatExemptionReason,
          totalAmountIncl: totalAmountIncl.toNumber(),
          lines: billingLines.map(x => ({
            planId: x.planId ?? null,
            name: x.lineName,
            description: x.lineDescription,
            netPriceAmount: x.lineTotalExcl.toFixed(2),
            netAmount: x.lineTotalExcl.toFixed(2),
            vat: {
              category: vatStrategy.vatCategory,
              percentage: vatStrategy.percentage.toFixed(2),
            },
          })),
        }, billingProfile, dryRun);
      } catch (error) {
        throw new TeamBillingResultError(
          `Failed to send invoice: ${error}`,
          billingLines.map(x => generateTeamBillingResult(x, billingProfile, { isInvoiceSent: "", isPaymentRequested: "" }))
        );
      }

      // Update billing event with invoice id and reference
      if (!dryRun) {
        if (!invoiceId) {
          throw new TeamBillingResultError(
            `Failed to finalize billing due to missing invoice id`,
            billingLines.map(x => generateTeamBillingResult(x, billingProfile, { isInvoiceSent: "", isPaymentRequested: "" }))
          );
        }
        console.log("Updating billing event with invoice id", invoiceId, "for billing event", billingEventId);
        await db
          .update(subscriptionBillingEvents)
          .set({ invoiceId: invoiceId })
          .where(eq(subscriptionBillingEvents.id, billingEventId!));
      }

      // Payment through Mollie
      if (!dryRun && !billingProfile.isManuallyBilled) {
        // Send payment request to mollie (on webhook, update billing event with payment result, notify admin on failure)
        try {
          await requestPayment({
            mollieCustomerId: billingProfile.mollieCustomerId!,
            mollieMandateId: mandate?.id ?? null,
            billingProfileId: billingProfile.id,
            billingEventId: billingEventId!,
            amountDue: totalAmountIncl.toFixed(2),
            teamId: teamId,
            companyName: billingProfile.companyName,
            billingEmail: billingProfile.billingEmail,
            invoiceReference: invoiceReference,
            billingDate: billingDate,
          });
          isPaymentRequested = true;
        } catch (error) {
          console.error(`Failed to request payment for billing event ${billingEventId}: ${error}`);
          // Fail silently, this is passed on through the isPaymentRequested field
        }
      }
    }

    // Update lastBilledAt date
    if (!dryRun) {
      await db
        .update(subscriptions)
        .set({ lastBilledAt: billingDate })
        .where(inArray(subscriptions.id, toBeBilledSubscriptions.map(subscription => subscription.id)));
    }

    return billingLines.map((x, i) => ({
      ...generateTeamBillingResult(x, billingProfile),
      status: "success",
      isInvoiceSent: invoiceId ? "x" : "",
      isPaymentRequested: billingProfile.isManuallyBilled ? "" : isPaymentRequested ? "x" : "?",
      message: "",
      billingProfileId: billingProfile.id,
      billingProfileStanding: billingProfile.profileStanding,
      isManuallyBilled: billingProfile.isManuallyBilled,
      teamId: teamId,
      companyName: billingProfile.companyName,
      companyStreet: billingProfile.address,
      companyPostalCode: billingProfile.postalCode,
      companyCity: billingProfile.city,
      companyCountry: billingProfile.country,
      companyVatNumber: billingProfile.vatNumber,
      billingEventId: billingEventId,
      invoiceId: invoiceId,
      invoiceReference: invoiceReference,
      totalAmountExcl: i === 0 ? totalAmountExcl.toNumber() : null,
      vatCategory: vatStrategy.vatCategory,
      vatPercentage: vatStrategy.percentage.toNumber(),
      vatExemptionReason: vatStrategy.vatExemptionReason,
      vatAmount: i === 0 ? totalVatAmount.toNumber() : null,
      totalAmountIncl: i === 0 ? totalAmountIncl.toNumber() : null,
      billingDate: billingDate.toISOString(),
    }));
  } catch (error) {
    try {
      // Remove billing event again
      if (billingEventId) {
        await db.transaction(async (tx) => {
          await tx
            .delete(subscriptionBillingEventLines)
            .where(eq(subscriptionBillingEventLines.subscriptionBillingEventId, billingEventId!));
          await tx
            .delete(subscriptionBillingEvents)
            .where(eq(subscriptionBillingEvents.id, billingEventId!));
        });
      }
    } catch (error) {
      throw new Error(`CRITICAL ERROR: Failed to remove billing event ${billingEventId} again: ${error}`);
    }
    throw error;
  }
}

async function calculateSubscriptionByMonthlyPeriods({
  subscription,
  billingDate,
}: {
  subscription: typeof subscriptions.$inferSelect;
  billingDate: Date;
}): Promise<SubscriptionBillingLine[]> {
  // Get billing period
  const subscriptionHasEnded = (subscription.endDate && subscription.endDate < billingDate) ?? false;
  const billingPeriodStartInclusive = addMilliseconds(
    TZDate.tz("UTC", subscription.lastBilledAt || subscription.startDate),
    1
  );
  const billingPeriodEndInclusive = TZDate.tz("UTC", subscriptionHasEnded ? subscription.endDate! : billingDate);

  if (billingPeriodStartInclusive > billingPeriodEndInclusive) {
    throw new Error(
      `Billing period start is after billing period end for subscription ${subscription.id}`
    );
  }

  // Split billing period into months [start of billing period, end of month 1], [beginning of month 2, end of month 2], ... [beginning of month n, end of billing period]
  const billingPeriodMonths = [];
  let nextStart = billingPeriodStartInclusive;
  while (nextStart <= billingPeriodEndInclusive) {
    let startOfPeriod = startOfMonth(nextStart);
    let endOfPeriod = endOfMonth(nextStart);
    if (endOfPeriod > billingPeriodEndInclusive) {
      endOfPeriod = billingPeriodEndInclusive;
    }
    billingPeriodMonths.push([startOfPeriod, nextStart, endOfPeriod]);
    nextStart = addMilliseconds(endOfPeriod, 1);
  }

  const results: SubscriptionBillingLine[] = [];

  for (const [startOfPeriodInclusive, startInclusive, endInclusive] of billingPeriodMonths) {
    results.push(await calculateSubscription({
      subscription,
      startOfPeriodInclusive,
      startInclusive,
      endInclusive,
    }))
  }

  return results;
}

async function calculateSubscription({
  subscription,
  startOfPeriodInclusive,
  startInclusive,
  endInclusive,
}: {
  subscription: typeof subscriptions.$inferSelect;
  startOfPeriodInclusive: Date;
  startInclusive: Date;
  endInclusive: Date;
}): Promise<SubscriptionBillingLine> {

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

  const billingConfigCheck = BillingConfigSchema.safeParse(subscription.billingConfig);
  if (!billingConfigCheck.success) {
    throw new Error(
      `Invalid billing config for subscription ${subscription.id}: ${billingConfigCheck.error.message}`
    );
  }
  const billingConfig = billingConfigCheck.data;

  // If the start is the first day of the month, and the end is the last day of the month, it's a full month
  const isEntireMonth =
    isSameDay(
      startInclusive,
      startOfMonth(startInclusive)
    ) &&
    isSameDay(endInclusive, endOfMonth(endInclusive));

  // Get usage before the subscription start date
  let usageBeforeSubscriptionStart = 0;
  if(startInclusive > startOfPeriodInclusive) {
    usageBeforeSubscriptionStart = (await db
      .select({ usage: count() })
      .from(transferEvents)
      .where(
        and(
          eq(transferEvents.teamId, subscription.teamId),
          gte(transferEvents.createdAt, startOfPeriodInclusive),
          lt(transferEvents.createdAt, startInclusive)
        )
      ))[0].usage ?? 0;
  }

  // If the billing period has ended, calculate the maximum included usage, otherwise assume full period allowance
  let includedUsage = Math.max(billingConfig.includedMonthlyDocuments - usageBeforeSubscriptionStart, 0);
  const minutesInPeriod = differenceInMinutes(
    endInclusive,
    startInclusive
  );
  const monthlyMinutes = new Decimal(31).times(24).times(60); // 31 days * 24 hours * 60 minutes
  let billingRatio = new Decimal(minutesInPeriod).div(monthlyMinutes);
  if (isEntireMonth || billingRatio.gt(1)) {
    billingRatio = new Decimal(1);
  }

  // Get usage for the billing period
  const incomingUsageByCompany = await db
    .select({ companyId: companies.id, companyName: companies.name, incomingUsage: count() })
    .from(transferEvents)
    .leftJoin(companies, eq(transferEvents.companyId, companies.id))
    .where(
      and(
        eq(transferEvents.teamId, subscription.teamId),
        gte(transferEvents.createdAt, startInclusive),
        lte(transferEvents.createdAt, endInclusive),
        eq(transferEvents.direction, "incoming")
      )
    )
    .groupBy(companies.id);
  const outgoingUsageByCompany = await db
    .select({ companyId: companies.id, companyName: companies.name, outgoingUsage: count() })
    .from(transferEvents)
    .leftJoin(companies, eq(transferEvents.companyId, companies.id))
    .where(
      and(
        eq(transferEvents.teamId, subscription.teamId),
        gte(transferEvents.createdAt, startInclusive),
        lte(transferEvents.createdAt, endInclusive),
        eq(transferEvents.direction, "outgoing")
      )
    )
    .groupBy(companies.id);

  let incomingUsageDecimal = new Decimal(0);
  let outgoingUsageDecimal = new Decimal(0);
  const perCompanyUsage: Record<string, { companyName: string, incomingUsage: Decimal, outgoingUsage: Decimal }> = {};
  for (const company of incomingUsageByCompany) {
    if (!perCompanyUsage[company.companyId ?? "unknown"]) {
      perCompanyUsage[company.companyId ?? "unknown"] = { companyName: company.companyName ?? "Deleted companies", incomingUsage: new Decimal(0), outgoingUsage: new Decimal(0) };
    }
    perCompanyUsage[company.companyId ?? "unknown"].incomingUsage = perCompanyUsage[company.companyId ?? "unknown"].incomingUsage.plus(company.incomingUsage);
    incomingUsageDecimal = incomingUsageDecimal.plus(company.incomingUsage);
  }
  for (const company of outgoingUsageByCompany) {
    if (!perCompanyUsage[company.companyId ?? "unknown"]) {
      perCompanyUsage[company.companyId ?? "unknown"] = { companyName: company.companyName ?? "Deleted companies", incomingUsage: new Decimal(0), outgoingUsage: new Decimal(0) };
    }
    perCompanyUsage[company.companyId ?? "unknown"].outgoingUsage = perCompanyUsage[company.companyId ?? "unknown"].outgoingUsage.plus(company.outgoingUsage);
    outgoingUsageDecimal = outgoingUsageDecimal.plus(company.outgoingUsage);
  }

  const usageDecimal = incomingUsageDecimal.plus(outgoingUsageDecimal);

  // Calculate billing amount
  const baseAmount = new Decimal(billingConfig.basePrice).times(billingRatio);

  const incomingDocumentOveragePrice = billingConfig.incomingDocumentOveragePrice !== undefined ? billingConfig.incomingDocumentOveragePrice : billingConfig.documentOveragePrice;
  const outgoingDocumentOveragePrice = billingConfig.outgoingDocumentOveragePrice !== undefined ? billingConfig.outgoingDocumentOveragePrice : billingConfig.documentOveragePrice;

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

  const overageAmountExcl = toBeBilledIncoming.times(incomingDocumentOveragePrice).plus(toBeBilledOutgoing.times(outgoingDocumentOveragePrice));

  // Add the base amount and the overage amount
  let totalAmountExcl = baseAmount.plus(overageAmountExcl).toNearest(0.01);

  // If a minimum price is set, and the total amount is less than the minimum price, set the total amount to the minimum price
  let minimumPrice: Decimal | null = null;
  if ("minimumPrice" in billingConfig && billingConfig.minimumPrice && billingConfig.minimumPrice > 0) {
    minimumPrice = new Decimal(billingConfig.minimumPrice).times(billingRatio);
    totalAmountExcl = Decimal.max(totalAmountExcl, minimumPrice).toNearest(0.01);
  }

  // Generate description for invoice line
  let lineDescription = `${formatISO(startInclusive, { representation: "date" })} - ${formatISO(endInclusive, { representation: "date" })}\n\n`;
  lineDescription += `Incoming: ${incomingUsageDecimal.toString()} documents\n`;
  lineDescription += `Outgoing: ${outgoingUsageDecimal.toString()} documents\n`;
  lineDescription += `Included in subscription: ${includedUsage} documents\n`;
  lineDescription += `Base price: € ${baseAmount.toNearest(0.01).toString()}\n`;
  if(minimumPrice) {
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