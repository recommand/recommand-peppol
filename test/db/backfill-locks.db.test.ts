import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  connectTestDatabase,
  deliveryRows,
  seedDocument,
  seedTeamAndCompany,
  testDatabaseUrl,
  truncateDocumentData,
} from "./harness";

// The backfill selects its documents with SKIP LOCKED, so a row another transaction
// holds is left out of the batch rather than waited for. An empty batch is therefore
// not proof that every document has its deliveries, and the job may not declare
// itself done on one. Only a real PostgreSQL can hold a row lock, so that is where
// this is asserted.

let pool: Pool;
let backfill: typeof import("../../data/deliveries/backfill");

describe.skipIf(!testDatabaseUrl)("the delivery backfill under a held row lock", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: () => {} }));
    backfill = await import("../../data/deliveries/backfill");
    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await truncateDocumentData(pool);
  });

  it("does not finish while a locked document is uncovered, and covers it once the lock is released", async () => {
    await seedDocument(pool, { id: "doc_01" });
    await seedDocument(pool, { id: "doc_02" });
    await seedDocument(pool, { id: "doc_03" });

    const holder = await pool.connect();
    const state = backfill.initialBackfillState();
    try {
      // A normal update of the document holds its row while the backfill runs.
      await holder.query("BEGIN");
      await holder.query(
        "SELECT id FROM peppol_transmitted_documents WHERE id = 'doc_03' FOR UPDATE"
      );

      const held = await backfill.runDeliveryBackfill(backfill.databaseBackfillStore, state, {
        batchSize: 2,
      });

      expect(held.documents).toBe(2);
      // The pass that could not see doc_03 wrote nothing at its end, but the read
      // that waits for nobody still finds it uncovered.
      expect(held.finished).toBe(false);
      expect(state.finished).toBe(false);
      expect(await deliveryRows(pool, "doc_03")).toEqual([]);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }

    const released = await backfill.runDeliveryBackfill(backfill.databaseBackfillStore, state, {
      batchSize: 2,
    });

    expect(released.documents).toBe(1);
    expect(released.finished).toBe(true);
    expect(state.finished).toBe(true);
    expect((await deliveryRows(pool, "doc_03")).map((row) => [row.channel, row.status])).toEqual([
      ["peppol", "delivered"],
    ]);
    expect(await deliveryRows(pool)).toHaveLength(3);
  });
});
