import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  connectTestDatabase,
  deliveryRows,
  deliveryStatusEventRows,
  seedDeliveryStatusRule,
  seedDocument,
  seedTeamAndCompany,
  testDatabaseUrl,
  truncateDocumentData,
} from "./harness";

// A fallback run hands messages to the mail service and then writes what became of
// them. Between the two the process can die and the database can refuse the write,
// and neither may cost the recipient's message its delivery row, its bill or its
// place in the document's own email fields. What survives such a stop is a property
// of what is committed and when, so it is asserted against a real PostgreSQL.

const mailed: string[] = [];
let pool: Pool;
let runEmailFallbackForDocument: typeof import("../../data/deliveries/email-fallback-db").runEmailFallbackForDocument;
let resumeStalledEmailFallbacks: typeof import("../../data/deliveries/email-fallback-db").resumeStalledEmailFallbacks;

/** Makes every write of the customer's copy of an event fail, as a full event store would. */
async function refuseEventWrites(pool: Pool) {
  await pool.query(`
    CREATE FUNCTION refuse_event_write() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'event storage unavailable'; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER refuse_event_write BEFORE INSERT ON rule_action_deliveries
      FOR EACH ROW EXECUTE FUNCTION refuse_event_write();
  `);
}

async function allowEventWrites(pool: Pool) {
  await pool.query(
    "DROP TRIGGER refuse_event_write ON rule_action_deliveries; DROP FUNCTION refuse_event_write()"
  );
}

async function documentRow(pool: Pool, id: string) {
  const { rows } = await pool.query(
    `SELECT sent_over_email AS "sentOverEmail", email_recipients AS "emailRecipients",
            email_fallback AS "emailFallback"
     FROM peppol_transmitted_documents WHERE id = $1`,
    [id]
  );
  return rows[0] as {
    sentOverEmail: boolean;
    emailRecipients: string[];
    emailFallback: { to: string[]; startedAt?: string; attempts?: Record<string, { deliveryId: string }> } | null;
  };
}

async function billedEmails(pool: Pool, documentId: string) {
  const { rows } = await pool.query(
    `SELECT id, type FROM peppol_transfer_events WHERE transmitted_document_id = $1 ORDER BY id`,
    [documentId]
  );
  return rows as { id: string; type: string }[];
}

describe.skipIf(!testDatabaseUrl)("recovering an email fallback against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: () => {} }));
    mock.module("@peppol/data/email/send-email", () => ({
      sendDocumentEmail: async ({ to }: { to: string }) => {
        mailed.push(to);
      },
    }));
    // The rules engine only writes for an event type it knows, so the real
    // registration runs and the payload is validated by the schema the product ships.
    (await import("../../lib/event-types")).registerPeppolEventTypes();
    const module = await import("../../data/deliveries/email-fallback-db");
    runEmailFallbackForDocument = module.runEmailFallbackForDocument;
    resumeStalledEmailFallbacks = module.resumeStalledEmailFallbacks;
    await seedTeamAndCompany(pool);
    await seedDeliveryStatusRule(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    mailed.length = 0;
    await truncateDocumentData(pool);
  });

  it("records and bills a message the mail service accepted exactly once when the first run could not write the event", async () => {
    await seedDocument(pool, {
      id: "doc_fallback",
      emailFallback: { to: ["a@example.com"], subject: "Invoice 1" },
    });

    await refuseEventWrites(pool);
    try {
      await expect(runEmailFallbackForDocument("doc_fallback")).rejects.toThrow(
        /rule_action_deliveries|event storage unavailable/
      );
    } finally {
      await allowEventWrites(pool);
    }

    // The message went out and its delivery row was written as the service accepted
    // it; everything the closing transaction would have written rolled back.
    expect(mailed).toEqual(["a@example.com"]);
    const afterFailure = await deliveryRows(pool, "doc_fallback");
    expect(afterFailure.map((row) => [row.channel, row.address, row.status])).toEqual([
      ["email", "a@example.com", "pending"],
    ]);
    expect(await billedEmails(pool, "doc_fallback")).toEqual([]);
    const stopped = await documentRow(pool, "doc_fallback");
    expect(stopped.sentOverEmail).toBe(false);
    expect(stopped.emailRecipients).toEqual([]);
    // The request is still there, with the address noted and no run holding it.
    expect(stopped.emailFallback).toMatchObject({
      to: ["a@example.com"],
      attempts: { "a@example.com": { deliveryId: afterFailure[0]!.id } },
    });
    expect(stopped.emailFallback?.startedAt).toBeUndefined();

    const outcome = await runEmailFallbackForDocument("doc_fallback");

    expect(outcome).toMatchObject({ kind: "sent", sent: ["a@example.com"], failed: [] });
    // Nothing was mailed again, and the accepted message is billed once.
    expect(mailed).toEqual(["a@example.com"]);
    expect((await deliveryRows(pool, "doc_fallback")).map((row) => row.id)).toEqual([
      afterFailure[0]!.id,
    ]);
    expect((await billedEmails(pool, "doc_fallback")).map((event) => event.type)).toEqual(["email"]);
    const recorded = await documentRow(pool, "doc_fallback");
    expect(recorded.sentOverEmail).toBe(true);
    expect(recorded.emailRecipients).toEqual(["a@example.com"]);
    expect(recorded.emailFallback).toBeNull();
    expect(await deliveryStatusEventRows(pool)).toHaveLength(1);

    // A third report finds the request closed and does nothing at all.
    expect(await runEmailFallbackForDocument("doc_fallback")).toEqual({ kind: "none" });
    expect(mailed).toEqual(["a@example.com"]);
    expect((await billedEmails(pool, "doc_fallback")).map((event) => event.type)).toEqual(["email"]);
  });

  it("leaves a request another run started on recently alone", async () => {
    await seedDocument(pool, {
      id: "doc_held",
      emailFallback: { to: ["a@example.com"], startedAt: new Date().toISOString() },
    });

    expect(await runEmailFallbackForDocument("doc_held")).toEqual({ kind: "none" });
    expect(mailed).toEqual([]);
    expect(await deliveryRows(pool, "doc_held")).toEqual([]);
  });

  it("finishes, from the drain, a run whose process died after the mail service accepted the message", async () => {
    const deliveryId = "dlv_stalled";
    await seedDocument(pool, {
      id: "doc_stalled",
      emailFallback: {
        to: ["a@example.com"],
        // Long enough ago that the run that left this is taken to have died.
        startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        attempts: { "a@example.com": { deliveryId } },
      },
    });
    await pool.query(
      `INSERT INTO peppol_document_deliveries
         (id, transmitted_document_id, team_id, company_id, channel, address, status)
       SELECT $1, id, team_id, company_id, 'email', 'a@example.com', 'pending'
       FROM peppol_transmitted_documents WHERE id = 'doc_stalled'`,
      [deliveryId]
    );

    expect(await resumeStalledEmailFallbacks()).toEqual({ found: 1, resumed: 1 });

    expect(mailed).toEqual([]);
    expect((await deliveryRows(pool, "doc_stalled")).map((row) => row.id)).toEqual([deliveryId]);
    expect((await billedEmails(pool, "doc_stalled")).map((event) => event.type)).toEqual(["email"]);
    const recorded = await documentRow(pool, "doc_stalled");
    expect(recorded.sentOverEmail).toBe(true);
    expect(recorded.emailRecipients).toEqual(["a@example.com"]);
    expect(recorded.emailFallback).toBeNull();

    // Nothing is left for the next drain.
    expect(await resumeStalledEmailFallbacks()).toEqual({ found: 0, resumed: 0 });
  });

  it("closes an address whose answer was never written as failed rather than mailing it again", async () => {
    await seedDocument(pool, {
      id: "doc_unknown",
      emailFallback: {
        to: ["a@example.com"],
        startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        attempts: { "a@example.com": { deliveryId: "dlv_unknown" } },
      },
    });

    const outcome = await runEmailFallbackForDocument("doc_unknown");

    expect(mailed).toEqual([]);
    expect(outcome).toMatchObject({ kind: "sent", sent: [] });
    expect((await deliveryRows(pool, "doc_unknown")).map((row) => [row.id, row.status, row.failureCategory])).toEqual([
      ["dlv_unknown", "failed", "other"],
    ]);
    // Nothing went out, so nothing is billed and the document's fields are untouched.
    expect(await billedEmails(pool, "doc_unknown")).toEqual([]);
    expect((await documentRow(pool, "doc_unknown")).sentOverEmail).toBe(false);
  });
});
