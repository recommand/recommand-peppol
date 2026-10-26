import { db } from "@recommand/db";
import { companies, transferEvents } from "@peppol/db/schema";
import { and, count, eq, gte, inArray, lt, lte } from "drizzle-orm";

/**
 * Usage is the record of what a team actually used: one transfer event per
 * chargeable transmission, recorded when the transmission is recorded. This module
 * is the contract for it. Producers record events here
 * and consumers, such as a commercial administration that prices usage, read
 * aggregates here; neither needs the table itself.
 *
 * Events are facts, not prices: which of them are included in a plan, charged as
 * overage or free is for the consumer to decide.
 */

import type { UsageDirection } from "@peppol/data/usage-event-id";

export { usageEventId, type UsageChannel, type UsageDirection } from "@peppol/data/usage-event-id";

export type UsageEvent = typeof transferEvents.$inferInsert;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTransaction = typeof db | Transaction;

/**
 * Record usage events. An event whose id is already recorded is skipped, which
 * makes recording idempotent for events built with `usageEventId`.
 */
export async function recordUsageEvents(events: UsageEvent[], tx?: DbOrTransaction) {
  if (events.length === 0) return;
  await (tx ?? db).insert(transferEvents).values(events).onConflictDoNothing({ target: transferEvents.id });
}

/** Count a team's usage events in [fromInclusive, toInclusive] or [fromInclusive, toExclusive). */
export async function countTeamUsage({
  teamId,
  fromInclusive,
  toInclusive,
  toExclusive,
}: {
  teamId: string;
  fromInclusive: Date;
  toInclusive?: Date;
  toExclusive?: Date;
}): Promise<number> {
  const [row] = await db
    .select({ usage: count() })
    .from(transferEvents)
    .where(
      and(
        eq(transferEvents.teamId, teamId),
        gte(transferEvents.createdAt, fromInclusive),
        toInclusive ? lte(transferEvents.createdAt, toInclusive) : undefined,
        toExclusive ? lt(transferEvents.createdAt, toExclusive) : undefined
      )
    );
  return row?.usage ?? 0;
}

export type CompanyUsage = {
  /** Null when the company no longer exists. */
  companyId: string | null;
  companyName: string | null;
  usage: number;
};

/** A team's usage events in [fromInclusive, toInclusive] in one direction, per company. */
export async function getTeamUsageByCompany({
  teamId,
  fromInclusive,
  toInclusive,
  direction,
}: {
  teamId: string;
  fromInclusive: Date;
  toInclusive: Date;
  direction: UsageDirection;
}): Promise<CompanyUsage[]> {
  return await db
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
        gte(transferEvents.createdAt, fromInclusive),
        lte(transferEvents.createdAt, toInclusive),
        eq(transferEvents.direction, direction)
      )
    )
    .groupBy(companies.id);
}

/** Usage events per team since `fromInclusive`, for the given teams. Teams without usage are absent. */
export async function countUsageByTeam({
  teamIds,
  fromInclusive,
}: {
  teamIds: string[];
  fromInclusive: Date;
}): Promise<Map<string, number>> {
  if (teamIds.length === 0) return new Map();
  const rows = await db
    .select({ teamId: transferEvents.teamId, usage: count() })
    .from(transferEvents)
    .where(and(inArray(transferEvents.teamId, teamIds), gte(transferEvents.createdAt, fromInclusive)))
    .groupBy(transferEvents.teamId);
  return new Map(rows.map((row) => [row.teamId, row.usage]));
}
