import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  TEAM_ID,
  connectTestDatabase,
  seedDelivery,
  seedDocument,
  seedTeamAndCompany,
  testDatabaseUrl,
  truncateDocumentData,
} from "./harness";

let pool: Pool;
let getTransmittedDocuments: typeof import("../../data/transmitted-documents").getTransmittedDocuments;
let withDocumentDeliveries: typeof import("../../data/deliveries").withDocumentDeliveries;

async function documentIds(options: Parameters<typeof getTransmittedDocuments>[1]) {
  const { documents } = await getTransmittedDocuments(TEAM_ID, { limit: 50, ...options });
  return documents.map((document) => document.id).sort();
}

describe.skipIf(!testDatabaseUrl)("the document delivery filters against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: () => {} }));
    getTransmittedDocuments = (await import("../../data/transmitted-documents")).getTransmittedDocuments;
    withDocumentDeliveries = (await import("../../data/deliveries")).withDocumentDeliveries;
    await seedTeamAndCompany(pool, { useTestNetwork: true });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
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
