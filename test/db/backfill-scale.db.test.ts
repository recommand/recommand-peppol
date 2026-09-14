import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, seedDocument, seedTeamAndCompany, testDatabaseUrl } from "./harness";

const count = Number(process.env.PEPPOL_BACKFILL_SCALE_COUNT ?? 0);
let pool: Pool;
let backfill: typeof import("../../data/deliveries/backfill");
let selection: { sql: string; params: unknown[] } | undefined;

describe.skipIf(!testDatabaseUrl || count < 1000)("delivery backfill at volume", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    const database = drizzle(pool, { logger: { logQuery(sql, params) {
      if (sql.includes("skip locked")) selection = { sql, params };
    } } });
    mock.module("@recommand/db", () => ({ db: database }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: () => {} }));
    backfill = await import("../../data/deliveries/backfill");
    await seedTeamAndCompany(pool);
    await seedDocument(pool, { id: "seed", direction: "incoming" });
    await pool.query(`INSERT INTO peppol_transmitted_documents
      SELECT (jsonb_populate_record(NULL::peppol_transmitted_documents,
        to_jsonb(t) || jsonb_build_object('id', 'doc_' || lpad(g::text, 9, '0'), 'direction', 'outgoing'))).*
      FROM peppol_transmitted_documents t CROSS JOIN generate_series(1, $1::int) g WHERE t.id = 'seed'`, [count]);
    await pool.query("ANALYZE peppol_transmitted_documents");
  }, 120_000);

  afterAll(async () => { await pool?.end(); });

  it("resumes after interruption and concurrent writes, completes and remains idempotent", async () => {
    const holder = await pool.connect();
    const started = performance.now();
    const samples: number[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM peppol_transmitted_documents WHERE id = 'doc_000000001' FOR UPDATE");
      await backfill.databaseBackfillStore.processBatch("", 500);
      const plan = await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + selection!.sql, selection!.params);
      console.log("BACKFILL_FIRST_PLAN", JSON.stringify(plan.rows));
      const state = backfill.initialBackfillState();
      const store = {
        ...backfill.databaseBackfillStore,
        async processBatch(afterId: string, limit: number) {
          const start = performance.now();
          const result = await backfill.databaseBackfillStore.processBatch(afterId, limit);
          samples.push(performance.now() - start);
          await pool.query("UPDATE peppol_transmitted_documents SET updated_at = now() WHERE id = 'seed'");
          return result;
        },
      };
      const progress = await backfill.runDeliveryBackfill(store, state);
      expect(progress.finished).toBe(false);
    } finally {
      await holder.query("ROLLBACK"); holder.release();
    }
    const resumed = await backfill.runDeliveryBackfill(backfill.databaseBackfillStore, backfill.initialBackfillState());
    expect(resumed.finished).toBe(true);
    const result = await pool.query("SELECT count(*)::int AS n, count(DISTINCT transmitted_document_id)::int AS documents FROM peppol_document_deliveries");
    expect(result.rows[0]).toEqual({ n: count, documents: count });
    const emptyStarted = performance.now();
    const again = await backfill.runDeliveryBackfill(backfill.databaseBackfillStore, backfill.initialBackfillState());
    expect(again).toEqual({ documents: 0, deliveries: 0, finished: true });
    const emptyMs = performance.now() - emptyStarted;
    const plan = await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + selection!.sql, selection!.params);
    console.log("BACKFILL_FINAL_PLAN", JSON.stringify(plan.rows));
    console.log("BACKFILL_BENCHMARK", JSON.stringify({ documents: count, totalMs: performance.now() - started, maxBatchMs: Math.max(...samples), emptyMs }));
  }, 300_000);
});
