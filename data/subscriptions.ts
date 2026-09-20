import { db } from "@recommand/db";
import { subscriptions } from "@peppol/db/schema";
import { eq, isNull, and, or, gte, lte, asc, gt, sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { BillingConfig } from "./plans";
import { addMilliseconds, endOfMonth } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { UserFacingError } from "@peppol/utils/util";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import {
  planSubscriptionChange,
  resolveEffectiveDate,
  type ResolvedSubscriptionConfig,
  type SubscriptionChangePlan,
  type SubscriptionEffective,
} from "./subscription-change";

export type Subscription = typeof subscriptions.$inferSelect;

/**
 * Serialize every change to a team's subscription periods for the rest of the
 * transaction. Each writer reads the team's state only after taking this lock, so
 * two callers cannot both act on the same snapshot and leave overlapping periods.
 */
export async function lockTeamSubscriptions(tx: Transaction, teamId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"peppol:subscription:" + teamId}))`);
}

/**
 * The latest instant the team's usage was billed up to, across every period the
 * team ever had. A billing run can settle a period ahead of time, so this may lie
 * in the future; a period that ended is billed no further than its own end.
 */
export async function getBilledThrough(teamId: string, tx?: Transaction): Promise<Date | null> {
  const [row] = await (tx ?? db)
    .select({
      // A period that was never billed contributes nothing; least() alone would
      // skip the null and count the period's end instead.
      billedThrough: sql`max(case when ${subscriptions.lastBilledAt} is null then null else least(${subscriptions.lastBilledAt}, coalesce(${subscriptions.endDate}, ${subscriptions.lastBilledAt})) end)`.mapWith(subscriptions.lastBilledAt),
    })
    .from(subscriptions)
    .where(eq(subscriptions.teamId, teamId));
  return row?.billedThrough ?? null;
}

type Transaction = PgTransaction<NodePgQueryResultHKT, Record<string, never>, ExtractTablesWithRelations<Record<string, never>>>;

export async function getSubscriptions(teamId: string, tx?: Transaction) {
  const allSubscriptions = await (tx ?? db)
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.teamId, teamId));

  return allSubscriptions;
}

export async function getActiveSubscription(teamId: string, tx?: Transaction, now: Date = new Date()) {
  const activeSubscription = await (tx ?? db)
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.teamId, teamId),
        or(
          and(
            lte(subscriptions.startDate, now),
            isNull(subscriptions.endDate),
          ),
          and(
            lte(subscriptions.startDate, now),
            gte(subscriptions.endDate, now)
          )
        )
      )
    );

  if (activeSubscription.length === 0) {
    return null;
  }

  return activeSubscription[0];
}

export async function getFutureSubscription(teamId: string, tx?: Transaction, now: Date = new Date()): Promise<Subscription | null> {
  const [futureSubscription] = await (tx ?? db)
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.teamId, teamId),
        gt(subscriptions.startDate, now)
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
    await lockTeamSubscriptions(tx, teamId);
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
    await lockTeamSubscriptions(tx, teamId);

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

export type SubscriptionChangeResult = {
  plan: SubscriptionChangePlan;
  applied: boolean;
  subscription: Subscription | null;
};

export class SubscriptionChangeConflictError extends UserFacingError {
  public readonly plan: SubscriptionChangePlan;
  constructor(plan: SubscriptionChangePlan) {
    super(plan.message);
    this.name = "SubscriptionChangeConflictError";
    this.plan = plan;
  }
}

/**
 * Apply a plan and rate change to a team, keeping every earlier period and its
 * rates intact. Never touches `lastBilledAt`, never bills and never charges: the
 * next billing cycle settles the old period at the old rates and the new period at
 * the new ones.
 *
 * The moment the change takes effect is read from `clock` only after the team lock
 * is held, so a change that waited for another writer is planned against the state
 * and the time that writer left behind. With `apply: false` this only plans, and
 * writes nothing at all.
 */
export async function applySubscriptionChange({
  teamId,
  resolved,
  effective,
  clock = () => new Date(),
  replaceScheduled = false,
  apply,
  expectedActiveSubscriptionId,
  expectedScheduledSubscriptionId,
}: {
  teamId: string;
  resolved: ResolvedSubscriptionConfig;
  effective: SubscriptionEffective;
  clock?: () => Date;
  replaceScheduled?: boolean;
  apply: boolean;
  expectedActiveSubscriptionId?: string | null;
  expectedScheduledSubscriptionId?: string | null;
}): Promise<SubscriptionChangeResult> {
  return await db.transaction(async (tx) => {
    // The same lock every subscription writer takes, so the state read below is
    // the state the writes apply to. A plan-only call reads without it.
    if (apply) {
      await lockTeamSubscriptions(tx, teamId);
    }

    const now = clock();
    const startDate = resolveEffectiveDate(effective, now);

    const active = await getActiveSubscription(teamId, tx, now);
    const scheduled = await getFutureSubscription(teamId, tx, now);
    const billedThrough = await getBilledThrough(teamId, tx);

    // Optimistic concurrency: the caller acted on what it inspected.
    if (apply && expectedActiveSubscriptionId !== undefined) {
      const seen = active?.id ?? null;
      if (seen !== (expectedActiveSubscriptionId ?? null)) {
        throw new UserFacingError(
          `The active subscription changed since it was inspected (expected ${expectedActiveSubscriptionId ?? "none"}, found ${seen ?? "none"}). Inspect the team again.`
        );
      }
    }
    if (apply && expectedScheduledSubscriptionId !== undefined) {
      const seen = scheduled?.id ?? null;
      if (seen !== (expectedScheduledSubscriptionId ?? null)) {
        throw new UserFacingError(
          `The scheduled subscription changed since it was inspected (expected ${expectedScheduledSubscriptionId ?? "none"}, found ${seen ?? "none"}). Inspect the team again.`
        );
      }
    }

    const plan = planSubscriptionChange({
      active,
      scheduled,
      resolved,
      startDate,
      now,
      replaceScheduled,
      billedThrough,
    });

    if (plan.outcome === "conflict") {
      if (!apply) {
        return { plan, applied: false, subscription: null };
      }
      throw new SubscriptionChangeConflictError(plan);
    }

    if (plan.outcome === "unchanged" || !apply) {
      return { plan, applied: false, subscription: null };
    }

    if (plan.replacesSubscriptionId) {
      await tx
        .delete(subscriptions)
        .where(eq(subscriptions.id, plan.replacesSubscriptionId));
    }

    if (plan.endsSubscriptionId && plan.endsAt) {
      await tx
        .update(subscriptions)
        .set({ endDate: plan.endsAt })
        .where(eq(subscriptions.id, plan.endsSubscriptionId));
    }

    const [subscription] = await tx
      .insert(subscriptions)
      .values({
        teamId,
        planId: resolved.planId,
        planName: resolved.planName,
        billingConfig: resolved.billingConfig,
        startDate: plan.startDate,
      })
      .returning();

    return { plan, applied: true, subscription };
  });
}
