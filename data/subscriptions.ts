import { db } from "@recommand/db";
import { subscriptions } from "@peppol/db/schema";
import { eq, isNull, and, or, gte, lte, asc, gt, type ExtractTablesWithRelations } from "drizzle-orm";
import type { BillingConfig } from "./plans";
import { addMilliseconds, endOfMonth } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { UserFacingError } from "@directory/utils/util";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";

export type Subscription = typeof subscriptions.$inferSelect;

type Transaction = PgTransaction<NodePgQueryResultHKT, Record<string, never>, ExtractTablesWithRelations<Record<string, never>>>;

export async function getSubscriptions(teamId: string, tx?: Transaction) {
  const allSubscriptions = await (tx ?? db)
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.teamId, teamId));

  return allSubscriptions;
}

export async function getActiveSubscription(teamId: string, tx?: Transaction) {
  const activeSubscription = await (tx ?? db)
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.teamId, teamId),
        or(
          and(
            lte(subscriptions.startDate, new Date()),
            isNull(subscriptions.endDate),
          ),
          and(
            lte(subscriptions.startDate, new Date()),
            gte(subscriptions.endDate, new Date())
          )
        )
      )
    );

  if (activeSubscription.length === 0) {
    return null;
  }

  return activeSubscription[0];
}

export async function getFutureSubscription(teamId: string, tx?: Transaction): Promise<Subscription | null> {
  const [futureSubscription] = await (tx ?? db)
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.teamId, teamId),
        gte(subscriptions.startDate, new Date())
      )
    )
    .orderBy(asc(subscriptions.startDate))
    .limit(1);

  return futureSubscription ?? null;
}

function isPlanUpgrade(currentPlanId: string | null, newPlanId: string | null) {
  if (!currentPlanId || !newPlanId) {
    return true;
  }
  const planHierarchy = ["developer", "starter", "professional", "enterprise"];
  const currentIndex = planHierarchy.indexOf(currentPlanId);
  const newIndex = planHierarchy.indexOf(newPlanId);
  return currentIndex <= newIndex;
}

export async function startSubscription(
  teamId: string,
  planId: string | null,
  planName: string,
  billingConfig: BillingConfig
) {


  return await db.transaction(async (tx) => {
    let endDate = new Date();

    const activeSubscription = await getActiveSubscription(teamId, tx);
    const futureSubscription = await getFutureSubscription(teamId, tx);
    if (futureSubscription) {
      // Remove future subscription and reset end date of active subscription
      await tx
        .delete(subscriptions)
        .where(eq(subscriptions.id, futureSubscription.id));
      if (activeSubscription) {
        await tx
          .update(subscriptions)
          .set({ endDate: new Date() })
          .where(eq(subscriptions.id, activeSubscription.id));
      }
    }

    // If there is an active subscription
    if (activeSubscription) {
      // Check if we are performing an upgrade or downgrade
      const isUpgrade = isPlanUpgrade(activeSubscription.planId, planId);

      // Upgrades happen instantly, downgrades happen at the end of the current month (UTC)
      if (isUpgrade) {
        endDate = new Date();
      } else {
        endDate = endOfMonth(TZDate.tz("UTC"));
      }
    }

    // End active subscription for this team
    if (activeSubscription) {
      await tx
        .update(subscriptions)
        .set({ endDate })
        .where(
          eq(subscriptions.id, activeSubscription.id)
        );
    }

    // Start new subscription
    const [subscription] = await tx
      .insert(subscriptions)
      .values({
        teamId,
        planId,
        planName,
        billingConfig,
        startDate: addMilliseconds(endDate, 1),
      })
      .returning();

    return subscription;
  });
}

export async function cancelSubscription(teamId: string) {
  return await db.transaction(async (tx) => {
    // End the subscription at the end of the current month (UTC)
    const endDate = endOfMonth(TZDate.tz("UTC"));

    const activeSubscription = await getActiveSubscription(teamId, tx);
    if (!activeSubscription) {
      throw new UserFacingError("No active subscription found for this team. Contact support@recommand.eu if you need to cancel your subscription.");
    }

    await tx
      .update(subscriptions)
      .set({ endDate: endDate })
      .where(eq(subscriptions.id, activeSubscription.id));

    // Remove all future subscriptions for this team
    await tx
      .delete(subscriptions)
      .where(and(eq(subscriptions.teamId, teamId), gt(subscriptions.startDate, endDate)));
  });
}
