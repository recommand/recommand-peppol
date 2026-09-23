import { billingProfiles, companies, subscriptions, transferEvents } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, count, eq, gt, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { SubscriptionBillingLine } from "./billing-types";
import {
  computeSubscriptionBillingLine,
  splitBillingPeriodIntoMonths,
  type Subscription,
  type SubscriptionUsage,
} from "./calculation";

export * from "./calculation";

/**
 * Read the usage a single monthly period is billed on. Read-only: it is shared by
 * the billing cycle and by read-only previews, so it must never write.
 */
export async function fetchSubscriptionUsage({
  teamId,
  startOfPeriodInclusive,
  startInclusive,
  endInclusive,
}: {
  teamId: string;
  startOfPeriodInclusive: Date;
  startInclusive: Date;
  endInclusive: Date;
}): Promise<SubscriptionUsage> {
  // Usage earlier in the same calendar month, billed under a previous subscription
  let usageBeforeSubscriptionStart = 0;
  if (startInclusive > startOfPeriodInclusive) {
    usageBeforeSubscriptionStart =
      (
        await db
          .select({ usage: count() })
          .from(transferEvents)
          .where(
            and(
              eq(transferEvents.teamId, teamId),
              gte(transferEvents.createdAt, startOfPeriodInclusive),
              lt(transferEvents.createdAt, startInclusive)
            )
          )
      )[0].usage ?? 0;
  }

  const usageByDirection = async (direction: "incoming" | "outgoing") =>
    await db
      .select({
        companyId: companies.id,
        companyName: companies.name,
        usage: count(),
      })
      .from(transferEvents)
      .leftJoin(companies, eq(transferEvents.companyId, companies.id))
      .where(
        and(
          eq(transferEvents.teamId, teamId),
          gte(transferEvents.createdAt, startInclusive),
          lte(transferEvents.createdAt, endInclusive),
          eq(transferEvents.direction, direction)
        )
      )
      .groupBy(companies.id);

  return {
    usageBeforeSubscriptionStart,
    incomingByCompany: await usageByDirection("incoming"),
    outgoingByCompany: await usageByDirection("outgoing"),
  };
}

/**
 * Calculate every unbilled monthly line of one subscription. Read-only.
 */
export async function calculateSubscriptionByMonthlyPeriods({
  subscription,
  billingDate,
}: {
  subscription: Subscription;
  billingDate: Date;
}): Promise<SubscriptionBillingLine[]> {
  const results: SubscriptionBillingLine[] = [];

  for (const period of splitBillingPeriodIntoMonths(subscription, billingDate)) {
    const usage = await fetchSubscriptionUsage({
      teamId: subscription.teamId,
      startOfPeriodInclusive: period.startOfPeriodInclusive,
      startInclusive: period.startInclusive,
      endInclusive: period.endInclusive,
    });
    results.push(
      computeSubscriptionBillingLine({
        subscription,
        startInclusive: period.startInclusive,
        endInclusive: period.endInclusive,
        usage,
      })
    );
  }

  return results;
}

/**
 * The subscription periods a billing run on `billingDate` settles: started before
 * the billing date, not yet billed up to it, and not already fully billed out.
 * Read-only, and shared with the read-only billing preview so both see the same
 * periods.
 */
export async function selectBillableSubscriptions(billingDate: Date, teamIds?: string[]): Promise<typeof subscriptions.$inferSelect[]> {
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

  return toBeBilled.map(row => row.peppol_subscriptions);
}
