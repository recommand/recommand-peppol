import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  TEAM_ID,
  connectTestDatabase,
  deliveryRows,
  seedDelivery,
  seedDocument,
  seedTeamAndCompany,
  testDatabaseUrl,
  truncateDocumentData,
} from "./harness";

// The backfill's selection and the list filters are SQL. The unit tests state the
// rules over an in-memory store and over a summary function; what the queries
// themselves select, skip and count can only be shown against a real PostgreSQL.

let pool: Pool;
let backfill: typeof import("../../data/deliveries/backfill");
let getTransmittedDocuments: typeof import("../../data/transmitted-documents").getTransmittedDocuments;
let withDocumentDeliveries: typeof import("../../data/deliveries").withDocumentDeliveries;

const documentDate = new Date("2026-03-01T10:00:00Z");

async function documentIds(options: Parameters<typeof getTransmittedDocuments>[1]) {
  const { documents } = await getTransmittedDocuments(TEAM_ID, { limit: 50, ...options });
  return documents.map((document) => document.id).sort();
}

describe.skipIf(!testDatabaseUrl)("the delivery backfill and the document filters against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: () => {} }));
    backfill = await import("../../data/deliveries/backfill");
    getTransmittedDocuments = (await import("../../data/transmitted-documents")).getTransmittedDocuments;
    withDocumentDeliveries = (await import("../../data/deliveries")).withDocumentDeliveries;
    // The documents this backfill is for were sent on the test network by a team that
    // is still on it; the rows have to say so or the poll would ask the wrong network.
    await seedTeamAndCompany(pool, { useTestNetwork: true });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("gives every historical outgoing document the deliveries its transmission implies, and writes nothing on a second run", async () => {
    await truncateDocumentData(pool);
    // Our own access point acknowledged the transmission in the send.
    await seedDocument(pool, { id: "doc_01", accessPointProvider: "recommand-ap1" });
    // A simulated send: no access point transaction of its own.
    await seedDocument(pool, { id: "doc_02", accessPointProvider: "at-shared-ap-fr" });
    // The shared access point took it and reports later.
    await seedDocument(pool, {
      id: "doc_03",
      accessPointProvider: "at-shared-ap-fr",
      apTransactionId: "tx-03",
    });
    // Addressed on the network, refused before it left, mailed instead.
    await seedDocument(pool, {
      id: "doc_04",
      sentOverPeppol: false,
      sentOverEmail: true,
      emailRecipients: ["a@example.com", "b@example.com"],
    });
    // Never addressed on the network: mailed to several recipients.
    await seedDocument(pool, {
      id: "doc_05",
      receiverId: null,
      sentOverPeppol: false,
      sentOverEmail: true,
      emailRecipients: ["c@example.com", "d@example.com", "e@example.com"],
    });
    // An incoming document and a filed report: neither was ever delivered by us.
    await seedDocument(pool, { id: "doc_06", direction: "incoming" });
    await seedDocument(pool, { id: "doc_07", externalReferenceId: "ext-1" });
    // A document recorded since delivery tracking: it already has its deliveries.
    await seedDocument(pool, { id: "doc_08", apTransactionId: "tx-08" });
    await seedDelivery(pool, {
      id: "dlv_recent",
      documentId: "doc_08",
      status: "delivered",
      provider: "at-shared-ap-fr",
      providerTransactionId: "tx-08",
    });

    const first = await backfill.runDeliveryBackfill(
      backfill.databaseBackfillStore,
      backfill.initialBackfillState(),
      { batchSize: 2 }
    );

    expect(first).toEqual({ documents: 5, deliveries: 9, finished: true });
    const rows = await deliveryRows(pool);
    expect(rows.map((row) => [row.documentId, row.channel, row.address, row.status])).toEqual([
      ["doc_01", "peppol", "0208:987654321", "delivered"],
      ["doc_02", "peppol", "0208:987654321", "delivered"],
      ["doc_03", "peppol", "0208:987654321", "pending"],
      ["doc_04", "peppol", "0208:987654321", "failed"],
      ["doc_04", "email", "a@example.com", "delivered"],
      ["doc_04", "email", "b@example.com", "delivered"],
      ["doc_05", "email", "c@example.com", "delivered"],
      ["doc_05", "email", "d@example.com", "delivered"],
      ["doc_05", "email", "e@example.com", "delivered"],
      ["doc_08", "peppol", "0208:987654321", "delivered"],
    ]);

    const written = await deliveryRows(pool, "doc_03");
    expect(written[0]).toMatchObject({
      provider: "at-shared-ap-fr",
      providerTransactionId: "tx-03",
      useTestNetwork: true,
      statusChangedAt: documentDate,
      createdAt: documentDate,
    });
    expect((await deliveryRows(pool, "doc_04"))[0]).toMatchObject({ failureCategory: "other" });
    // The document that already had a delivery kept the one it had.
    expect((await deliveryRows(pool, "doc_08")).map((row) => row.id)).toEqual(["dlv_recent"]);

    const second = await backfill.runDeliveryBackfill(
      backfill.databaseBackfillStore,
      backfill.initialBackfillState(),
      { batchSize: 2 }
    );

    expect(second).toEqual({ documents: 0, deliveries: 0, finished: true });
    expect(await deliveryRows(pool)).toHaveLength(10);
  });

  it("returns exactly the documents each delivery filter names", async () => {
    await truncateDocumentData(pool);
    const cases = {
      delivered: ["delivered"],
      failed: ["failed"],
      pending: ["pending"],
      pending_and_failed: ["pending", "failed"],
      delivered_and_failed: ["delivered", "failed"],
    } as const;
    for (const [id, statuses] of Object.entries(cases)) {
      await seedDocument(pool, { id, receiverId: null, emailRecipients: [] });
      for (const [index, status] of statuses.entries()) {
        await seedDelivery(pool, {
          id: `dlv_${id}_${index}`,
          documentId: id,
          channel: "email",
          address: `${index}@example.com`,
          status,
        });
      }
    }
    // Documents with no deliveries at all: an outgoing one recorded before the
    // backfill reached it, and an incoming one that will never have any.
    await seedDocument(pool, { id: "no_deliveries" });
    await seedDocument(pool, { id: "incoming", direction: "incoming" });

    expect(await documentIds({ deliveryStatus: "delivered" })).toEqual([
      "delivered",
      "delivered_and_failed",
    ]);
    expect(await documentIds({ deliveryStatus: "failed" })).toEqual(["failed"]);
    expect(await documentIds({ deliveryStatus: "pending" })).toEqual([
      "pending",
      "pending_and_failed",
    ]);
    expect(await documentIds({ deliveryFailed: true })).toEqual([
      "delivered_and_failed",
      "failed",
      "pending_and_failed",
    ]);
    expect(await documentIds({ deliveryFailed: false })).toEqual([
      "delivered",
      "incoming",
      "no_deliveries",
      "pending",
    ]);
    expect(await documentIds({ deliveryStatus: "failed", deliveryFailed: true })).toEqual(["failed"]);

    // The filters and the summary the same documents are returned with are two
    // expressions of one rule; they have to agree on every case.
    const { documents } = await getTransmittedDocuments(TEAM_ID, { limit: 50 });
    const summarised = await withDocumentDeliveries(documents);
    expect(
      Object.fromEntries(summarised.map((document) => [document.id, document.deliveryStatus]))
    ).toEqual({
      delivered: "delivered",
      delivered_and_failed: "delivered",
      failed: "failed",
      pending: "pending",
      pending_and_failed: "pending",
      no_deliveries: null,
      incoming: null,
    });
  });
});
