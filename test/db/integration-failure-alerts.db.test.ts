import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// The failed-run count behind integration failure emails: a failing scheduled run is
// reported once it reaches the threshold, once per incident, and a successful run ends
// the incident.

let pool: Pool;
let integrations: typeof import("../../data/integrations");
const INTEGRATION_ID = "itg_db_test";

async function counters() {
  const { rows } = await pool.query(
    `SELECT consecutive_failed_runs, failure_notified_at FROM activated_integrations WHERE id = $1`,
    [INTEGRATION_ID],
  );
  return rows[0];
}

describe.skipIf(!testDatabaseUrl)("integration failure alerts against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    integrations = await import("../../data/integrations");
    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM activated_integrations`);
    await pool.query(
      `INSERT INTO activated_integrations (id, team_id, company_id, manifest, state) VALUES ($1, $2, $3, '{}', '{}')`,
      [INTEGRATION_ID, TEAM_ID, COMPANY_ID],
    );
  });

  it("notifies once, on the run that reaches the threshold", async () => {
    const results = [];
    for (let run = 0; run < integrations.FAILED_RUNS_BEFORE_NOTIFICATION + 2; run++) {
      results.push(await integrations.recordFailedRun(INTEGRATION_ID));
    }
    expect(results).toEqual([false, false, true, false, false]);
    expect((await counters()).consecutive_failed_runs).toBe(integrations.FAILED_RUNS_BEFORE_NOTIFICATION + 2);
  });

  it("starts a new incident after a successful run", async () => {
    for (let run = 0; run < integrations.FAILED_RUNS_BEFORE_NOTIFICATION; run++) await integrations.recordFailedRun(INTEGRATION_ID);
    await integrations.recordSuccessfulRun(INTEGRATION_ID);
    expect(await counters()).toEqual({ consecutive_failed_runs: 0, failure_notified_at: null });
    const results = [];
    for (let run = 0; run < integrations.FAILED_RUNS_BEFORE_NOTIFICATION; run++) {
      results.push(await integrations.recordFailedRun(INTEGRATION_ID));
    }
    expect(results).toEqual([false, false, true]);
  });

  it("forgets a failure that the next run got past", async () => {
    await integrations.recordFailedRun(INTEGRATION_ID);
    await integrations.recordSuccessfulRun(INTEGRATION_ID);
    await integrations.recordFailedRun(INTEGRATION_ID);
    await integrations.recordFailedRun(INTEGRATION_ID);
    expect((await counters()).consecutive_failed_runs).toBe(2);
    expect((await counters()).failure_notified_at).toBeNull();
  });

  it("notifies only one of several runs racing past the threshold", async () => {
    await integrations.recordFailedRun(INTEGRATION_ID);
    const results = await Promise.all(Array.from({ length: 5 }, () => integrations.recordFailedRun(INTEGRATION_ID)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
