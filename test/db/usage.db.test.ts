import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// The usage contract against PostgreSQL: recording the same usage again charges
// nothing more, and the aggregates a consumer prices usage on count what they say.

let pool: Pool;
let usage: typeof import("../../data/usage");

const event = (overrides: Partial<import("../../data/usage").UsageEvent> & { transmittedDocumentId: string }) => ({
  id: usage.usageEventId({
    transmittedDocumentId: overrides.transmittedDocumentId,
    direction: overrides.direction ?? "outgoing",
    channel: overrides.type ?? "peppol",
  }),
  teamId: TEAM_ID,
  companyId: COMPANY_ID,
  direction: "outgoing" as const,
  type: "peppol" as const,
  ...overrides,
});

async function usageRows() {
  const { rows } = await pool.query(`SELECT id, direction, type FROM peppol_transfer_events ORDER BY id`);
  return rows;
}

describe.skipIf(!testDatabaseUrl)("usage recording and aggregation against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    usage = await import("../../data/usage");
    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE peppol_transfer_events");
  });

  it("records a replayed event once", async () => {
    const events = [
      event({ transmittedDocumentId: "doc_1" }),
      event({ transmittedDocumentId: "doc_2", direction: "incoming" }),
    ];

    await usage.recordUsageEvents(events);
    await usage.recordUsageEvents(events);
    await usage.recordUsageEvents([events[0]]);

    expect(await usageRows()).toEqual([
      { id: "te_doc_1_outgoing_peppol", direction: "outgoing", type: "peppol" },
      { id: "te_doc_2_incoming_peppol", direction: "incoming", type: "peppol" },
    ]);
  });

  it("keeps events recorded without a key, as before keys existed", async () => {
    const { id: _id, ...unkeyed } = event({ transmittedDocumentId: "doc_1" });
    await usage.recordUsageEvents([unkeyed, unkeyed]);
    expect(await usageRows()).toHaveLength(2);
  });

  it("counts a team's usage over inclusive and exclusive bounds", async () => {
    await pool.query(
      `INSERT INTO peppol_transfer_events (id, team_id, company_id, direction, created_at) VALUES
         ('te_a', $1, $2, 'outgoing', '2026-09-01T00:00:00.000Z'),
         ('te_b', $1, $2, 'incoming', '2026-09-15T12:00:00.000Z'),
         ('te_c', $1, $2, 'outgoing', '2026-09-30T23:59:59.999Z'),
         ('te_d', 'team_other', $2, 'outgoing', '2026-09-15T12:00:00.000Z')`,
      [TEAM_ID, COMPANY_ID]
    );

    const from = new Date("2026-09-01T00:00:00.000Z");
    const end = new Date("2026-09-30T23:59:59.999Z");
    expect(await usage.countTeamUsage({ teamId: TEAM_ID, fromInclusive: from, toInclusive: end })).toBe(3);
    expect(await usage.countTeamUsage({ teamId: TEAM_ID, fromInclusive: from, toExclusive: end })).toBe(2);
    expect(await usage.countTeamUsage({ teamId: TEAM_ID, fromInclusive: from })).toBe(3);

    const byTeam = await usage.countUsageByTeam({ teamIds: [TEAM_ID, "team_other", "team_none"], fromInclusive: from });
    expect(Object.fromEntries(byTeam)).toEqual({ [TEAM_ID]: 3, team_other: 1 });
    expect(await usage.countUsageByTeam({ teamIds: [], fromInclusive: from })).toEqual(new Map());
  });

  it("splits usage per company and direction, naming companies that no longer exist as unknown", async () => {
    await pool.query(
      `INSERT INTO peppol_transfer_events (id, team_id, company_id, direction, created_at) VALUES
         ('te_a', $1, $2, 'outgoing', '2026-09-10T00:00:00.000Z'),
         ('te_b', $1, $2, 'outgoing', '2026-09-11T00:00:00.000Z'),
         ('te_c', $1, 'cmp_deleted', 'outgoing', '2026-09-12T00:00:00.000Z'),
         ('te_d', $1, $2, 'incoming', '2026-09-12T00:00:00.000Z')`,
      [TEAM_ID, COMPANY_ID]
    );

    const outgoing = await usage.getTeamUsageByCompany({
      teamId: TEAM_ID,
      fromInclusive: new Date("2026-09-01T00:00:00.000Z"),
      toInclusive: new Date("2026-09-30T23:59:59.999Z"),
      direction: "outgoing",
    });

    expect(outgoing.sort((a, b) => (a.companyId ?? "").localeCompare(b.companyId ?? ""))).toEqual([
      { companyId: null, companyName: null, usage: 1 },
      { companyId: COMPANY_ID, companyName: "Example SARL", usage: 2 },
    ]);
  });
});
