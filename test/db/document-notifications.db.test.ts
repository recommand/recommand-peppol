import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  COMPANY_ID,
  connectTestDatabase,
  seedDocument,
  seedTeamAndCompany,
  testDatabaseUrl,
  truncateDocumentData,
} from "./harness";

// What the notification records and the unreachable mark on an address look like after
// the sends, refusals and reports that move them. The mark is set by a conditional
// update that only one caller can win, and the list of failed notifications reads the
// latest row per document, so both are asserted against a real PostgreSQL.

const ADDRESS = "accounting@example.com";
const alerts: { title: string; message: string }[] = [];
let pool: Pool;
let notifications: typeof import("../../data/document-notifications");

async function configureAddress(email = ADDRESS) {
  await pool.query(
    `INSERT INTO peppol_company_notification_email_addresses (id, company_id, email, notify_incoming)
     VALUES ($1, $2, $3, true)`,
    [`cnea_${email}`, COMPANY_ID, email]
  );
}

async function addressMark(email = ADDRESS) {
  const { rows } = await pool.query(
    `SELECT unreachable_since, unreachable_reason FROM peppol_company_notification_email_addresses WHERE email = $1`,
    [email]
  );
  return rows[0] as { unreachable_since: Date | null; unreachable_reason: string | null };
}

async function notificationRow(id: string) {
  const { rows } = await pool.query(
    `SELECT status, failure_category, failure_provider_code, provider_message_id FROM peppol_document_notifications WHERE id = $1`,
    [id]
  );
  return rows[0];
}

/** An error shaped like the one Postmark's client throws for a deactivated recipient. */
async function inactiveRecipientError() {
  const { Errors } = await import("postmark");
  return new Errors.InactiveRecipientsError(
    `You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: ${ADDRESS}.`,
    406,
    422
  );
}

async function attempt(documentId: string) {
  const id = await notifications.recordNotificationAttempt({
    transmittedDocumentId: documentId,
    companyId: COMPANY_ID,
    direction: "incoming",
    address: ADDRESS,
  });
  expect(id).not.toBeNull();
  return id!;
}

describe.skipIf(!testDatabaseUrl)("document notifications against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({
      sendSystemAlert: async (title: string, message: string) => {
        alerts.push({ title, message });
      },
    }));
    notifications = await import("../../data/document-notifications");
    await seedTeamAndCompany(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    alerts.length = 0;
    await truncateDocumentData(pool);
    await pool.query(`TRUNCATE peppol_company_notification_email_addresses`);
    await configureAddress();
    for (const id of ["doc_a", "doc_b", "doc_c"]) {
      await seedDocument(pool, { id, direction: "incoming" });
    }
  });

  it("records an accepted notification as pending with its message", async () => {
    const id = await attempt("doc_a");
    await notifications.recordNotificationAccepted(id, "msg-a");
    expect(await notificationRow(id)).toMatchObject({ status: "pending", provider_message_id: "msg-a" });
  });

  it("marks the address once and alerts once, however many notifications are refused", async () => {
    const error = await inactiveRecipientError();
    await Promise.all(
      ["doc_a", "doc_b", "doc_c"].map(async (documentId) =>
        notifications.recordNotificationRefused(await attempt(documentId), ADDRESS, error)
      )
    );

    const { rows } = await pool.query(`SELECT status, failure_category, failure_provider_code FROM peppol_document_notifications`);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "failed" && row.failure_category === "recipient_rejected"
      && row.failure_provider_code === "406")).toBe(true);
    expect((await addressMark()).unreachable_since).not.toBeNull();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain(ADDRESS);
  });

  it("does not mark the address for a refusal that is not about the address", async () => {
    const id = await attempt("doc_a");
    await notifications.recordNotificationRefused(id, ADDRESS, new Error("render failed"));
    expect(await notificationRow(id)).toMatchObject({ status: "failed", failure_category: "other" });
    expect((await addressMark()).unreachable_since).toBeNull();
    expect(alerts).toEqual([]);
  });

  it("marks the address when a bounce deactivated it, and clears it when later mail is delivered", async () => {
    const bounced = await attempt("doc_a");
    const outcome = await notifications.applyNotificationReport({
      notificationId: bounced,
      status: "failed",
      failure: { category: "recipient_not_found", message: "The server was unable to deliver your message", providerCode: "HardBounce" },
      addressDeactivated: true,
      occurredAt: new Date("2026-10-22T08:00:00Z"),
    });
    expect(outcome).toBe("applied");
    expect(await addressMark()).toEqual({
      unreachable_since: new Date("2026-10-22T08:00:00Z"),
      unreachable_reason: "The server was unable to deliver your message",
    });

    // A delivery that happened before the bounce says nothing about the address now.
    const earlier = await attempt("doc_b");
    await notifications.applyNotificationReport({
      notificationId: earlier, status: "delivered", failure: null, addressDeactivated: false,
      occurredAt: new Date("2026-10-22T07:00:00Z"),
    });
    expect((await addressMark()).unreachable_since).not.toBeNull();

    const later = await attempt("doc_c");
    await notifications.applyNotificationReport({
      notificationId: later, status: "delivered", failure: null, addressDeactivated: false,
      occurredAt: new Date("2026-10-26T15:00:00Z"),
    });
    expect(await addressMark()).toEqual({ unreachable_since: null, unreachable_reason: null });
  });

  it("lets a bounce fail a delivered notification, but nothing revive a failed one", async () => {
    const id = await attempt("doc_a");
    const delivered = { notificationId: id, status: "delivered" as const, failure: null, addressDeactivated: false, occurredAt: new Date() };
    const bounced = {
      notificationId: id, status: "failed" as const, addressDeactivated: false, occurredAt: new Date(),
      failure: { category: "transport" as const, message: "Mailbox full", providerCode: "SoftBounce" },
    };
    expect(await notifications.applyNotificationReport(delivered)).toBe("applied");
    expect(await notifications.applyNotificationReport(bounced)).toBe("applied");
    expect(await notifications.applyNotificationReport(delivered)).toBe("unchanged");
    expect(await notificationRow(id)).toMatchObject({ status: "failed", failure_provider_code: "SoftBounce" });
    expect(await notifications.applyNotificationReport({ ...delivered, notificationId: "dntf_unknown" })).toBe("unknown");
  });

  it("lists the documents whose latest notification to the address failed, in the period asked", async () => {
    const error = await inactiveRecipientError();
    for (const documentId of ["doc_a", "doc_b", "doc_c"]) {
      await notifications.recordNotificationRefused(await attempt(documentId), ADDRESS, error);
    }
    // doc_b was sent again successfully; doc_c failed outside the period.
    await notifications.recordNotificationAccepted(await attempt("doc_b"), "msg-b");
    await pool.query(
      `UPDATE peppol_document_notifications SET status_changed_at = '2026-10-20T00:00:00Z'
       WHERE transmitted_document_id = 'doc_c'`
    );

    const all = await notifications.listFailedNotifications({ address: "Accounting@Example.com", limit: 10 });
    expect(all.notifications.map((n) => n.transmittedDocumentId)).toEqual(["doc_c", "doc_a"]);
    expect(all.truncated).toBe(false);

    const inPeriod = await notifications.listFailedNotifications({
      address: ADDRESS, since: new Date("2026-10-21T00:00:00Z"), limit: 10,
    });
    expect(inPeriod.notifications.map((n) => n.transmittedDocumentId)).toEqual(["doc_a"]);

    const limited = await notifications.listFailedNotifications({ address: ADDRESS, limit: 1 });
    expect(limited).toMatchObject({ truncated: true });
    expect(limited.notifications).toHaveLength(1);
  });
});
