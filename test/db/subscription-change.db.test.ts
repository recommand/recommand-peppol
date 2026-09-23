import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";
import { resolveSubscriptionConfig, type ResolvedSubscriptionConfig } from "../../data/subscription-change";
import { allPlans } from "../../data/plans";

// What a subscription change does to the database: which periods survive, what the
// billing cursor keeps, and what two operators racing on the same team end up with.
// Those are properties of the transaction, so they are asserted against a real
// PostgreSQL rather than a faked database module.

let pool: Pool;
let subscriptionsData: typeof import("../../data/subscriptions");

const NOW = new Date("2026-09-17T10:30:00.000Z");
const NEXT_MONTH = new Date("2026-10-01T00:00:00.000Z");

const customRates = (): ResolvedSubscriptionConfig =>
  resolveSubscriptionConfig("professional", {
    name: "Professional custom",
    basePrice: 0,
    includedMonthlyDocuments: 1000,
    documentOveragePrice: 0.06,
  });

async function seedSubscription(row: {
  id: string;
  planId?: string | null;
  planName?: string;
  billingConfig?: Record<string, unknown>;
  startDate: string;
  endDate?: string | null;
  lastBilledAt?: string | null;
}) {
  await pool.query(
    `INSERT INTO peppol_subscriptions (id, team_id, plan_id, plan_name, billing_config, start_date, end_date, last_billed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.id,
      TEAM_ID,
      row.planId === undefined ? "professional" : row.planId,
      row.planName ?? "Professional 1000",
      JSON.stringify(
        row.billingConfig ?? {
          name: "Professional 1000",
          basePrice: 99,
          includedMonthlyDocuments: 1000,
          documentOveragePrice: 0.1,
        }
      ),
      row.startDate,
      row.endDate ?? null,
      row.lastBilledAt ?? null,
    ]
  );
}

type SubscriptionRow = {
  id: string;
  planId: string | null;
  planName: string;
  billingConfig: Record<string, unknown>;
  startDate: Date;
  endDate: Date | null;
  lastBilledAt: Date | null;
};

async function subscriptionRows() {
  const { rows } = await pool.query(
    `SELECT id, plan_id AS "planId", plan_name AS "planName", billing_config AS "billingConfig",
            start_date AS "startDate", end_date AS "endDate", last_billed_at AS "lastBilledAt"
     FROM peppol_subscriptions WHERE team_id = $1 ORDER BY start_date`,
    [TEAM_ID]
  );
  return rows as SubscriptionRow[];
}

/** Two periods overlap when both are running at the same instant; an open end runs forever. */
function overlap(a: SubscriptionRow, b: SubscriptionRow) {
  const aEnd = a.endDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.endDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.startDate.getTime() <= bEnd && b.startDate.getTime() <= aEnd;
}

/** What the billing cycle relies on: at most one period is billable at any instant. */
function expectNoOverlappingPeriods(rows: SubscriptionRow[]) {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      expect(overlap(rows[i], rows[j])).toBe(false);
    }
  }
  expect(rows.filter((row) => row.endDate === null).length).toBeLessThanOrEqual(1);
}

const starterConfig = { name: "Starter", basePrice: 29, includedMonthlyDocuments: 200, documentOveragePrice: 0.2 };
const professionalPlan = allPlans.find((plan) => plan.id === "professional")!;

describe.skipIf(!testDatabaseUrl)("subscription changes against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    subscriptionsData = await import("../../data/subscriptions");
    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE peppol_subscriptions CASCADE`);
  });

  // Every change here is decided at NOW unless a test passes its own clock.
  const change = (overrides: Partial<Parameters<typeof subscriptionsData.applySubscriptionChange>[0]> = {}) =>
    subscriptionsData.applySubscriptionChange({
      teamId: TEAM_ID,
      resolved: customRates(),
      effective: "next-month",
      clock: () => NOW,
      apply: true,
      ...overrides,
    });

  it("keeps the earlier period, its rates and its billing cursor", async () => {
    await seedSubscription({
      id: "sub_old",
      startDate: "2026-01-01T00:00:00.000Z",
      lastBilledAt: "2026-08-31T23:59:59.999Z",
    });

    const result = await change();
    expect(result.applied).toBe(true);

    const rows = await subscriptionRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "sub_old", planName: "Professional 1000" });
    expect(rows[0].billingConfig.basePrice).toBe(99);
    expect(rows[0].endDate?.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(rows[0].lastBilledAt?.toISOString()).toBe("2026-08-31T23:59:59.999Z");
    expect(rows[1].startDate.toISOString()).toBe(NEXT_MONTH.toISOString());
    expect(rows[1].billingConfig).toMatchObject({ basePrice: 0, documentOveragePrice: 0.06 });
  });

  it("never sets a billing cursor on the period it creates", async () => {
    await seedSubscription({ id: "sub_old", startDate: "2026-01-01T00:00:00.000Z" });
    await change();
    const rows = await subscriptionRows();
    expect(rows[1].lastBilledAt).toBeNull();
  });

  it("keeps the base plan so plan-driven access does not change with the rates", async () => {
    await change();
    const rows = await subscriptionRows();
    expect(rows[0].planId).toBe("professional");
    expect(rows[0].planName).toBe("Professional custom");
    expect(rows[0].billingConfig.name).toBe("Professional custom");
  });

  it("starts a first period for a team that never had a subscription", async () => {
    const result = await change();
    expect(result.applied).toBe(true);
    const rows = await subscriptionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].endDate).toBeNull();
  });

  it("writes nothing at all when apply is false", async () => {
    await seedSubscription({ id: "sub_old", startDate: "2026-01-01T00:00:00.000Z" });
    const before = await subscriptionRows();

    const result = await change({ apply: false });
    expect(result.applied).toBe(false);
    expect(result.plan.outcome).toBe("apply");
    expect(result.plan.endsAt?.toISOString()).toBe("2026-09-30T23:59:59.999Z");

    expect(await subscriptionRows()).toEqual(before);
  });

  it("does not create a second period when the same change is repeated", async () => {
    await seedSubscription({ id: "sub_old", startDate: "2026-01-01T00:00:00.000Z" });
    await change();
    const afterFirst = await subscriptionRows();

    const repeat = await change();
    expect(repeat.applied).toBe(false);
    expect(repeat.plan.outcome).toBe("unchanged");
    expect(await subscriptionRows()).toEqual(afterFirst);
  });

  it("refuses to replace a scheduled change unless that was asked for", async () => {
    await seedSubscription({ id: "sub_old", startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-10-31T23:59:59.999Z" });
    await seedSubscription({ id: "sub_scheduled", planName: "Starter", startDate: "2026-11-01T00:00:00.000Z" });
    const before = await subscriptionRows();

    await expect(change()).rejects.toThrow(/--replace-scheduled/);
    expect(await subscriptionRows()).toEqual(before);

    const replaced = await change({ replaceScheduled: true });
    expect(replaced.applied).toBe(true);
    const rows = await subscriptionRows();
    expect(rows.map((row) => row.id)).not.toContain("sub_scheduled");
    expect(rows[0].endDate?.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(rows[1].startDate.toISOString()).toBe(NEXT_MONTH.toISOString());
  });

  it("refuses a change when the state moved since it was inspected", async () => {
    await seedSubscription({ id: "sub_old", startDate: "2026-01-01T00:00:00.000Z" });
    const before = await subscriptionRows();

    await expect(change({ expectedActiveSubscriptionId: "sub_someone_else" })).rejects.toThrow(
      /changed since it was inspected/
    );
    await expect(change({ expectedScheduledSubscriptionId: "sub_ghost" })).rejects.toThrow(
      /changed since it was inspected/
    );
    expect(await subscriptionRows()).toEqual(before);

    const result = await change({
      expectedActiveSubscriptionId: "sub_old",
      expectedScheduledSubscriptionId: null,
    });
    expect(result.applied).toBe(true);
  });

  it("lets only one of two concurrent identical changes create a period", async () => {
    await seedSubscription({ id: "sub_old", startDate: "2026-01-01T00:00:00.000Z" });

    const results = await Promise.allSettled([change(), change()]);
    const applied = results.filter(
      (result) => result.status === "fulfilled" && result.value.applied
    );
    expect(applied).toHaveLength(1);

    const rows = await subscriptionRows();
    expect(rows).toHaveLength(2);
  });

  it("refuses an immediate change after a billing run that settled the month ahead", async () => {
    // A billing run on 2026-09-10 with billing date 2026-09-30 billed September in full.
    await seedSubscription({
      id: "sub_old",
      startDate: "2026-01-01T00:00:00.000Z",
      lastBilledAt: "2026-09-30T23:59:59.999Z",
    });
    const before = await subscriptionRows();

    await expect(change({ effective: "now" })).rejects.toThrow(/already billed through 2026-09-30T23:59:59\.999Z/);
    expect(await subscriptionRows()).toEqual(before);

    const next = await change({ effective: "next-month" });
    expect(next.applied).toBe(true);
    const rows = await subscriptionRows();
    expect(rows[0].endDate?.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(rows[1].startDate.toISOString()).toBe(NEXT_MONTH.toISOString());
  });

  it("does not let an ended period's cursor block beyond that period's own end", async () => {
    // The earlier period ended in August but was settled by a run dated end of September.
    await seedSubscription({
      id: "sub_prev",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-08-31T23:59:59.999Z",
      lastBilledAt: "2026-09-30T23:59:59.999Z",
    });
    await seedSubscription({ id: "sub_cur", startDate: "2026-09-01T00:00:00.000Z" });

    const result = await change({ effective: "now" });
    expect(result.applied).toBe(true);
    const rows = await subscriptionRows();
    expect(rows.map((row) => row.id)).toContain("sub_prev");
    expect(rows.find((row) => row.id === "sub_cur")?.endDate?.toISOString()).toBe("2026-09-17T10:29:59.999Z");
  });

  it("ignores an ended period that was never billed when guarding the billed span", async () => {
    await seedSubscription({ id: "sub_prev", startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-09-30T23:59:59.999Z" });
    const result = await change({ effective: "now", replaceScheduled: true });
    expect(result.applied).toBe(true);
    expectNoOverlappingPeriods(await subscriptionRows());
  });

  it("applies an immediate change from the moment it is made", async () => {
    await seedSubscription({ id: "sub_old", startDate: "2026-01-01T00:00:00.000Z" });
    const result = await change({ effective: "now" });
    expect(result.applied).toBe(true);
    expect(result.plan.startDate.toISOString()).toBe(NOW.toISOString());

    const rows = await subscriptionRows();
    expect(rows[0].endDate?.toISOString()).toBe("2026-09-17T10:29:59.999Z");
    expect(rows[1].startDate.toISOString()).toBe(NOW.toISOString());
  });

  describe("next to the customer API", () => {
    // These run on the real clock: the customer API decides its own dates.
    const seedRunningStarter = () =>
      seedSubscription({ id: "sub_old", planId: "starter", planName: "Starter", billingConfig: starterConfig, startDate: "2026-01-01T00:00:00.000Z" });
    const realClock = () => new Date();
    const immediate = (overrides: Partial<Parameters<typeof subscriptionsData.applySubscriptionChange>[0]> = {}) =>
      change({ effective: "now", clock: realClock, ...overrides });
    const scheduleNextMonth = (overrides: Partial<Parameters<typeof subscriptionsData.applySubscriptionChange>[0]> = {}) =>
      change({ effective: "next-month", clock: realClock, ...overrides });
    const upgrade = () => subscriptionsData.startSubscription(TEAM_ID, "professional", professionalPlan.name, professionalPlan);

    it("lets a later customer upgrade end a period that support created", async () => {
      await seedRunningStarter();
      const support = await immediate();
      expect(support.applied).toBe(true);

      await upgrade();

      const rows = await subscriptionRows();
      expectNoOverlappingPeriods(rows);
      expect(rows).toHaveLength(3);
      expect(rows[1]).toMatchObject({ id: support.subscription!.id, planName: "Professional custom" });
      expect(rows[1].endDate).not.toBeNull();
      expect(rows[2]).toMatchObject({ planName: "Professional 1000", endDate: null });
    });

    it("refuses a support change inspected before a customer upgrade, and builds on the upgrade otherwise", async () => {
      await seedRunningStarter();
      await upgrade();
      const before = await subscriptionRows();

      await expect(
        immediate({ expectedActiveSubscriptionId: "sub_old", expectedScheduledSubscriptionId: null })
      ).rejects.toThrow(/changed since it was inspected/);
      expect(await subscriptionRows()).toEqual(before);

      const rebased = await immediate();
      expect(rebased.applied).toBe(true);
      const rows = await subscriptionRows();
      expectNoOverlappingPeriods(rows);
      expect(rows.find((row) => row.planName === "Professional 1000")?.endDate).not.toBeNull();
      expect(rows[rows.length - 1]).toMatchObject({ id: rebased.subscription!.id, endDate: null });
    });

    it("takes its time from after the lock, not from when the caller decided", async () => {
      await seedRunningStarter();
      const decidedAt = new Date();
      await upgrade();

      // A clock frozen at the decision time would put the upgrade in the future and
      // could be talked into replacing it; the change is planned at the current time.
      const result = await change({ effective: "now", clock: realClock, replaceScheduled: true });
      expect(result.applied).toBe(true);
      expect(result.plan.startDate.getTime()).toBeGreaterThan(decidedAt.getTime());
      expect(result.plan.replacesSubscriptionId).toBeNull();
      const rows = await subscriptionRows();
      expectNoOverlappingPeriods(rows);
      expect(rows.map((row) => row.planName)).toEqual(["Starter", "Professional 1000", "Professional custom"]);
    });

    it("refuses to schedule over a customer cancellation unless told to", async () => {
      await seedRunningStarter();
      await subscriptionsData.cancelSubscription(TEAM_ID);
      const before = await subscriptionRows();

      await expect(scheduleNextMonth()).rejects.toThrow(/scheduled to end/);
      expect(await subscriptionRows()).toEqual(before);

      const overridden = await scheduleNextMonth({ replaceScheduled: true });
      expect(overridden.applied).toBe(true);
      expectNoOverlappingPeriods(await subscriptionRows());
    });

    it("lets a later customer cancellation remove a period support scheduled", async () => {
      await seedRunningStarter();
      const scheduled = await scheduleNextMonth();
      expect(scheduled.applied).toBe(true);

      await subscriptionsData.cancelSubscription(TEAM_ID);

      const rows = await subscriptionRows();
      expect(rows.map((row) => row.id)).toEqual(["sub_old"]);
      expect(rows[0].endDate).not.toBeNull();
    });

    it("never leaves overlapping periods when racing a customer upgrade", async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await pool.query(`TRUNCATE peppol_subscriptions CASCADE`);
        await seedRunningStarter();

        const [support, customer] = await Promise.allSettled([
          immediate({ expectedActiveSubscriptionId: "sub_old", expectedScheduledSubscriptionId: null }),
          upgrade(),
        ]);
        expect(customer.status).toBe("fulfilled");

        const rows = await subscriptionRows();
        expectNoOverlappingPeriods(rows);
        // Whichever order the lock granted, the customer's later decision is the one running,
        // and support either applied first or was told its state had moved.
        const running = rows.filter((row) => row.endDate === null);
        expect(running).toHaveLength(1);
        expect(running[0].planName).toBe("Professional 1000");
        if (support.status === "fulfilled") {
          expect(support.value.applied).toBe(true);
          expect(rows.find((row) => row.id === support.value.subscription!.id)?.endDate).not.toBeNull();
        } else {
          expect(String(support.reason)).toMatch(/changed since it was inspected|not after the current period/);
        }
      }
    });

    it("never loses a customer cancellation when racing a support change", async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await pool.query(`TRUNCATE peppol_subscriptions CASCADE`);
        await seedRunningStarter();

        const [support, customer] = await Promise.allSettled([
          scheduleNextMonth({ expectedActiveSubscriptionId: "sub_old", expectedScheduledSubscriptionId: null }),
          subscriptionsData.cancelSubscription(TEAM_ID),
        ]);
        expect(customer.status).toBe("fulfilled");

        const rows = await subscriptionRows();
        expect(rows.map((row) => row.id)).toEqual(["sub_old"]);
        expect(rows[0].endDate).not.toBeNull();
        if (support.status === "rejected") {
          expect(String(support.reason)).toMatch(/scheduled to end/);
        } else {
          expect(support.value.applied).toBe(true);
        }
      }
    });
  });
});
