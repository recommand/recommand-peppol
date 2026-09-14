import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  COMPANY_ID,
  TEAM_ID,
  connectTestDatabase,
  deliveryRows,
  deliveryStatusEventRows,
  seedDelivery,
  seedDeliveryStatusRule,
  seedDocument,
  seedTeamAndCompany,
  testDatabaseUrl,
  truncateDocumentData,
} from "./harness";

// What a delivery report does to the database when more than one caller is applying
// one, and what is left behind when the write that tells the customer fails. Both
// are properties of the transaction, so they are asserted against a real PostgreSQL:
// the fakes in test/persistence answer every query with whatever the test set up and
// cannot show a conditional update losing a race or a rollback taking the status
// change with it.

const alerts: { title: string; message: string }[] = [];
let pool: Pool;
let deliveries: typeof import("../../data/deliveries");
let recordOutgoingDocument: typeof import("../../data/record-outgoing-document").recordOutgoingDocument;
let claimEmailFallbackStatement: typeof import("../../data/deliveries/email-fallback-consume").claimEmailFallbackStatement;
let database: ReturnType<typeof drizzle>;

type Report = import("../../data/deliveries/model").ProviderDeliveryReport;

function peppolReport(overrides: Partial<Report> = {}): Report {
  return {
    channel: "peppol",
    provider: "at-shared-ap-fr",
    providerTransactionId: "tx-1",
    useTestNetwork: false,
    status: "failed",
    failure: { category: "validation", message: "Schematron failed", providerCode: "TXE-1005" },
    eventId: "evt-1",
    eventType: "transaction.send_failed",
    payload: { transactionId: "tx-1" },
    ...overrides,
  };
}

function emailReport(overrides: Partial<Report> = {}): Report {
  return {
    channel: "email",
    provider: "postmark",
    providerTransactionId: "msg-1",
    useTestNetwork: false,
    status: "delivered",
    failure: null,
    eventId: null,
    eventType: "Delivery",
    payload: { RecordType: "Delivery" },
    ...overrides,
  };
}

const company = {
  id: COMPANY_ID,
  name: "Example SARL",
  country: "FR",
  accessPointProvider: "at-shared-ap-fr",
  smpProvider: "at-shared-smp-fr",
} as never;

/** Records an outgoing document the way the sending pipeline does, with its deliveries. */
async function record(id: string, apTransactionId: string) {
  return await recordOutgoingDocument({
    c: null,
    id,
    teamId: TEAM_ID,
    company,
    isPlayground: true,
    useTestNetwork: false,
    inputFormat: "json_api",
    document: {
      senderId: "0225:123456789",
      receiverId: "0208:987654321",
      docTypeId: "doc-type",
      processId: "process",
      countryC1: "FR",
      type: "invoice",
      parsed: null,
      xml: "<Invoice/>",
    },
    delivery: {
      kind: "peppol",
      sentPeppol: true,
      emailRecipients: [],
      as4Response: {
        ok: true,
        peppolMessageId: null,
        peppolConversationId: null,
        receivedPeppolSignalMessage: null,
        sbdhInstanceIdentifier: "env-1",
        apTransactionId,
      },
    },
  });
}

describe.skipIf(!testDatabaseUrl)("document deliveries against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    database = drizzle(pool);
    mock.module("@recommand/db", () => ({ db: database }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({
      sendSystemAlert: (title: string, message: string) => {
        alerts.push({ title, message });
      },
    }));
    mock.module("@peppol/data/send-document-notifications", () => ({
      sendOutgoingDocumentNotifications: async () => {},
    }));
    // The rules engine only writes for an event type it knows, so the real
    // registration runs: the payload these tests produce is validated by the schema
    // the product ships.
    (await import("../../lib/event-types")).registerPeppolEventTypes();
    deliveries = await import("../../data/deliveries");
    recordOutgoingDocument = (await import("../../data/record-outgoing-document"))
      .recordOutgoingDocument;
    claimEmailFallbackStatement = (
      await import("../../data/deliveries/email-fallback-consume")
    ).claimEmailFallbackStatement;
    await seedTeamAndCompany(pool);
    await seedDeliveryStatusRule(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    alerts.length = 0;
    await truncateDocumentData(pool);
  });

  it("hands a document's email fallback request to exactly one of two concurrent runs and marks it started", async () => {
    await seedDocument(pool, {
      id: "doc_fallback",
      emailFallback: { to: ["a@example.com"], subject: "Invoice 1" },
    });
    await seedDocument(pool, { id: "doc_no_fallback" });

    const now = new Date("2026-09-10T12:00:00Z");
    const staleBefore = new Date("2026-09-10T11:45:00Z");
    // The first run holds its transaction open while the second one starts, so the
    // second really does meet a locked row rather than one already marked started.
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const statement = claimEmailFallbackStatement(database, "doc_fallback", {
        now,
        staleBefore,
      }).toSQL();
      await first.query("BEGIN");
      const held = await first.query(statement.sql, statement.params as unknown[]);
      const contended = second.query(statement.sql, statement.params as unknown[]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await first.query("COMMIT");
      const loser = await contended;

      expect(held.rows).toHaveLength(1);
      // The statement returns the columns of the locked selection, so the request is
      // the value the row carried before it was marked started.
      expect(held.rows[0]!.email_fallback).toEqual({ to: ["a@example.com"], subject: "Invoice 1" });
      expect(loser.rows).toEqual([]);
    } finally {
      first.release();
      second.release();
    }

    const { rows } = await pool.query(
      "SELECT id, email_fallback FROM peppol_transmitted_documents ORDER BY id"
    );
    // The request stays with the document, held by the run that took it, so a run
    // that stops halfway leaves everything a later run needs to finish the job.
    expect(rows.map((row) => [row.id, row.email_fallback])).toEqual([
      ["doc_fallback", { to: ["a@example.com"], subject: "Invoice 1", startedAt: now.toISOString() }],
      ["doc_no_fallback", null],
    ]);

    // A document that never had a request is not written at all: its row version is
    // the one it was inserted with.
    const version = async () =>
      (await pool.query("SELECT xmin FROM peppol_transmitted_documents WHERE id = 'doc_no_fallback'"))
        .rows[0]!.xmin;
    const before = await version();
    const none = await claimEmailFallbackStatement(database, "doc_no_fallback", { now, staleBefore });
    expect(none).toEqual([]);
    expect(await version()).toBe(before);
  });

  it("applies a report that arrived before its document when the document is recorded, once", async () => {
    const staged = await deliveries.applyProviderDeliveryReport(
      peppolReport({ providerTransactionId: "tx-early" })
    );
    expect(staged).toBe("staged");
    expect(alerts.map((alert) => alert.title)).toContain(
      "Delivery Report For Unrecorded Transaction"
    );
    expect(
      (await pool.query("SELECT provider FROM peppol_provider_delivery_reports")).rows
    ).toHaveLength(1);

    const recorded = await record("doc_report_first", "tx-early");

    expect(recorded.deliveries.map((delivery) => delivery.status)).toEqual(["failed"]);
    const rows = await deliveryRows(pool, "doc_report_first");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "failed",
      failureCategory: "validation",
      failureProviderCode: "TXE-1005",
      providerTransactionId: "tx-early",
    });
    expect((await pool.query("SELECT provider FROM peppol_provider_delivery_reports")).rows).toEqual([]);

    const events = await deliveryStatusEventRows(pool);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.payload).toMatchObject({
      deliveryId: rows[0]!.id,
      status: "failed",
      previousStatus: "pending",
    });
  });

  it("applies a report that arrives after its document to the recorded delivery, once", async () => {
    const recorded = await record("doc_document_first", "tx-late");
    expect(recorded.deliveries.map((delivery) => delivery.status)).toEqual(["pending"]);
    expect(await deliveryStatusEventRows(pool)).toEqual([]);

    const outcome = await deliveries.applyProviderDeliveryReport(
      peppolReport({ providerTransactionId: "tx-late" })
    );

    expect(outcome).toBe("applied");
    const rows = await deliveryRows(pool, "doc_document_first");
    expect(rows[0]).toMatchObject({ status: "failed", failureCategory: "validation" });
    expect((await pool.query("SELECT provider FROM peppol_provider_delivery_reports")).rows).toEqual([]);

    const events = await deliveryStatusEventRows(pool);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.payload).toMatchObject({ status: "failed", previousStatus: "pending" });
  });

  it("lets only one of two concurrent failure reports move the delivery, and never regresses it afterwards", async () => {
    await seedDocument(pool, { id: "doc_race", apTransactionId: "tx-race" });
    await seedDelivery(pool, {
      id: "dlv_race",
      documentId: "doc_race",
      provider: "at-shared-ap-fr",
      providerTransactionId: "tx-race",
    });

    const outcomes = await Promise.all([
      deliveries.applyProviderDeliveryReport(peppolReport({ providerTransactionId: "tx-race", eventId: "evt-a" })),
      deliveries.applyProviderDeliveryReport(peppolReport({ providerTransactionId: "tx-race", eventId: "evt-b" })),
    ]);

    expect(outcomes.slice().sort()).toEqual(["applied", "unchanged"]);
    expect((await deliveryRows(pool, "doc_race"))[0]).toMatchObject({ status: "failed" });
    expect(await deliveryStatusEventRows(pool)).toHaveLength(1);

    // A confirmation that arrives after the failure does not undo it, and a repeat of
    // the failure changes nothing: a delivery leaves an open status once.
    expect(
      await deliveries.applyProviderDeliveryReport(
        peppolReport({ providerTransactionId: "tx-race", status: "delivered", failure: null })
      )
    ).toBe("unchanged");
    expect(
      await deliveries.applyProviderDeliveryReport(peppolReport({ providerTransactionId: "tx-race" }))
    ).toBe("unchanged");

    expect((await deliveryRows(pool, "doc_race"))[0]).toMatchObject({
      status: "failed",
      failureCategory: "validation",
    });
    expect(await deliveryStatusEventRows(pool)).toHaveLength(1);
  });

  it("rolls the status change back when the customer's copy of the event cannot be written", async () => {
    await seedDocument(pool, { id: "doc_rollback", apTransactionId: "tx-rollback" });
    await seedDelivery(pool, {
      id: "dlv_rollback",
      documentId: "doc_rollback",
      provider: "at-shared-ap-fr",
      providerTransactionId: "tx-rollback",
    });
    // The event write is the rules engine's insert, inside the same transaction as the
    // status change. Making that insert fail in the database needs no seam in the code
    // and is the failure the guarantee is about.
    await pool.query(`
      CREATE FUNCTION refuse_event_write() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'event storage unavailable'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER refuse_event_write BEFORE INSERT ON rule_action_deliveries
        FOR EACH ROW EXECUTE FUNCTION refuse_event_write();
    `);

    try {
      const failure: (Error & { cause?: Error }) | null = await deliveries
        .applyProviderDeliveryReport(peppolReport({ providerTransactionId: "tx-rollback" }))
        .then(() => null, (error: Error & { cause?: Error }) => error);
      expect(failure?.message).toContain("rule_action_deliveries");
      expect(failure?.cause?.message).toBe("event storage unavailable");

      expect((await deliveryRows(pool, "doc_rollback"))[0]).toMatchObject({
        status: "pending",
        failureCategory: null,
      });
      expect(await deliveryStatusEventRows(pool)).toEqual([]);
    } finally {
      await pool.query("DROP TRIGGER refuse_event_write ON rule_action_deliveries; DROP FUNCTION refuse_event_write()");
    }

    // The provider retries; with the event storage back the report lands as usual.
    expect(
      await deliveries.applyProviderDeliveryReport(peppolReport({ providerTransactionId: "tx-rollback" }))
    ).toBe("applied");
    expect((await deliveryRows(pool, "doc_rollback"))[0]).toMatchObject({ status: "failed" });
    expect(await deliveryStatusEventRows(pool)).toHaveLength(1);
  });

  it("replays an acknowledged report after recording fails, without a new webhook or provider response", async () => {
    await deliveries.applyProviderDeliveryReport(peppolReport({ providerTransactionId: "tx-recover" }));
    await pool.query(`
      CREATE FUNCTION refuse_staged_event() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'event storage unavailable'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER refuse_staged_event BEFORE INSERT ON rule_action_deliveries
        FOR EACH ROW EXECUTE FUNCTION refuse_staged_event();
    `);
    try {
      await record("doc_recover", "tx-recover");
      expect((await deliveryRows(pool, "doc_recover"))[0]!.status).toBe("pending");
      await pool.query("UPDATE peppol_provider_delivery_reports SET reported_at = now() - interval '8 days'");
      expect(await deliveries.pruneStagedDeliveryReports()).toBe(0);
    } finally {
      await pool.query("DROP TRIGGER refuse_staged_event ON rule_action_deliveries; DROP FUNCTION refuse_staged_event()");
    }
    let providerCalls = 0;
    mock.module("@peppol/data/at/client", () => ({
      getArratechConfig: () => ({ orgId: "test" }),
      fetchArratechJson: async () => { providerCalls++; throw new Error("provider unavailable"); },
    }));
    const { runDeliveryReconciliationTick } = await import("../../data/deliveries/reconcile");
    const logger = { info: () => {}, warn: () => {}, error: () => {} } as never;
    await runDeliveryReconciliationTick(logger);
    await runDeliveryReconciliationTick(logger);
    expect(providerCalls).toBe(0);
    expect((await deliveryRows(pool, "doc_recover"))[0]!.status).toBe("failed");
    expect(await deliveryStatusEventRows(pool)).toHaveLength(1);
    expect((await pool.query("SELECT * FROM peppol_provider_delivery_reports")).rows).toEqual([]);
  });

  it("retains a failing report while applying another and only prunes unmatched expired reports", async () => {
    for (const suffix of ["bad", "good", "missing"]) {
      await deliveries.applyProviderDeliveryReport(emailReport({ providerTransactionId: `msg-${suffix}` }));
    }
    for (const suffix of ["bad", "good"]) {
      await seedDocument(pool, { id: `doc_${suffix}` });
      await seedDelivery(pool, { id: `dlv_${suffix}`, documentId: `doc_${suffix}`, channel: "email", provider: "postmark", providerTransactionId: `msg-${suffix}` });
    }
    await pool.query(`
      UPDATE peppol_provider_delivery_reports SET reported_at = now() - interval '8 days';
      CREATE FUNCTION refuse_one_delivery() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = 'dlv_bad' THEN RAISE EXCEPTION 'delivery unavailable'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER refuse_one_delivery BEFORE UPDATE ON peppol_document_deliveries
        FOR EACH ROW EXECUTE FUNCTION refuse_one_delivery();
    `);
    const errors: string[] = [];
    const logger = { error: (message: string) => errors.push(message) } as never;
    try {
      expect(await deliveries.drainStagedDeliveryReports(logger)).toBe(1);
      expect(errors).toHaveLength(1);
      expect(await deliveries.pruneStagedDeliveryReports()).toBe(1);
      expect((await pool.query("SELECT provider_transaction_id FROM peppol_provider_delivery_reports")).rows).toEqual([{ provider_transaction_id: "msg-bad" }]);
    } finally {
      await pool.query("DROP TRIGGER refuse_one_delivery ON peppol_document_deliveries; DROP FUNCTION refuse_one_delivery()");
    }
    await Promise.all([deliveries.drainStagedDeliveryReports(logger), deliveries.drainStagedDeliveryReports(logger)]);
    expect(await deliveryStatusEventRows(pool)).toHaveLength(2);
    expect((await pool.query("SELECT * FROM peppol_provider_delivery_reports")).rows).toEqual([]);
  });

  it("matches a mail service report by our delivery id before the message id", async () => {
    await seedDocument(pool, { id: "doc_email", emailRecipients: ["a@example.com", "b@example.com"] });
    // The first message's id was not recorded; the second one's was.
    await seedDelivery(pool, {
      id: "dlv_email_untracked",
      documentId: "doc_email",
      channel: "email",
      address: "a@example.com",
      provider: "postmark",
      providerTransactionId: null,
    });
    await seedDelivery(pool, {
      id: "dlv_email_tracked",
      documentId: "doc_email",
      channel: "email",
      address: "b@example.com",
      provider: "postmark",
      providerTransactionId: "msg-1",
    });

    expect(
      await deliveries.applyProviderDeliveryReport(
        emailReport({ deliveryId: "dlv_email_untracked", providerTransactionId: "msg-1" })
      )
    ).toBe("applied");

    const rows = await deliveryRows(pool, "doc_email");
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ["dlv_email_untracked", "delivered"],
      ["dlv_email_tracked", "pending"],
    ]);
  });

  it("matches a mail service report by the message id when it names no delivery of its own", async () => {
    await seedDocument(pool, { id: "doc_email_id", emailRecipients: ["b@example.com"] });
    await seedDelivery(pool, {
      id: "dlv_email_by_message",
      documentId: "doc_email_id",
      channel: "email",
      address: "b@example.com",
      provider: "postmark",
      providerTransactionId: "msg-1",
    });

    expect(await deliveries.applyProviderDeliveryReport(emailReport())).toBe("applied");

    expect((await deliveryRows(pool, "doc_email_id"))[0]).toMatchObject({
      id: "dlv_email_by_message",
      status: "delivered",
    });
  });

  it("ignores a delivery id that belongs to another provider's delivery and falls back to the message id", async () => {
    await seedDocument(pool, {
      id: "doc_mixed",
      apTransactionId: "tx-mixed",
      emailRecipients: ["b@example.com"],
    });
    await seedDelivery(pool, {
      id: "dlv_peppol_mixed",
      documentId: "doc_mixed",
      provider: "at-shared-ap-fr",
      providerTransactionId: "tx-mixed",
    });
    await seedDelivery(pool, {
      id: "dlv_email_mixed",
      documentId: "doc_mixed",
      channel: "email",
      address: "b@example.com",
      provider: "postmark",
      providerTransactionId: "msg-2",
    });

    // A mail service report that echoes back an id belonging to the Peppol delivery
    // must not move it; the message id is the reference that decides.
    expect(
      await deliveries.applyProviderDeliveryReport(
        emailReport({ deliveryId: "dlv_peppol_mixed", providerTransactionId: "msg-2" })
      )
    ).toBe("applied");

    const rows = await deliveryRows(pool, "doc_mixed");
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ["dlv_peppol_mixed", "pending"],
      ["dlv_email_mixed", "delivered"],
    ]);
  });

  it("ignores a delivery id whose delivery was sent as another message and falls back to the message id", async () => {
    await seedDocument(pool, { id: "doc_wrong_id", emailRecipients: ["a@example.com", "b@example.com"] });
    await seedDelivery(pool, {
      id: "dlv_other_message",
      documentId: "doc_wrong_id",
      channel: "email",
      address: "a@example.com",
      provider: "postmark",
      providerTransactionId: "msg-3",
    });
    await seedDelivery(pool, {
      id: "dlv_this_message",
      documentId: "doc_wrong_id",
      channel: "email",
      address: "b@example.com",
      provider: "postmark",
      providerTransactionId: "msg-1",
    });

    expect(
      await deliveries.applyProviderDeliveryReport(emailReport({ deliveryId: "dlv_other_message" }))
    ).toBe("applied");

    const rows = await deliveryRows(pool, "doc_wrong_id");
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ["dlv_other_message", "pending"],
      ["dlv_this_message", "delivered"],
    ]);
  });
});
