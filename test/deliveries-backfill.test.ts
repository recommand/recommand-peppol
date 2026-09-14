import { describe, expect, it, mock } from "bun:test";

// The row rules and the batch loop are pure; the database store is exercised against
// a real Postgres separately, so the connection is never opened here.
mock.module("@recommand/db", () => ({ db: {} }));

const {
  buildHistoricalDeliveries,
  initialBackfillState,
  runDeliveryBackfill,
} = await import("../data/deliveries/backfill");
type BackfillStore = import("../data/deliveries/backfill").BackfillStore;
type HistoricalOutgoingDocument = import("../data/deliveries/backfill").HistoricalOutgoingDocument;

const createdAt = new Date("2026-03-01T10:00:00Z");

function document(overrides: Partial<HistoricalOutgoingDocument> & { id: string }): HistoricalOutgoingDocument {
  return {
    teamId: "team_1",
    companyId: "cmp_1",
    receiverId: "0208:1",
    sentOverPeppol: true,
    emailRecipients: [],
    accessPointProvider: "recommand-ap1",
    apTransactionId: null,
    useTestNetwork: false,
    createdAt,
    ...overrides,
  };
}

describe("deliveries for documents recorded before delivery tracking", () => {
  it("marks a transmission through our own access point delivered, dated with the document", () => {
    const rows = buildHistoricalDeliveries(document({ id: "doc_1" }));
    expect(rows).toEqual([
      expect.objectContaining({
        transmittedDocumentId: "doc_1",
        channel: "peppol",
        address: "0208:1",
        status: "delivered",
        provider: null,
        providerTransactionId: null,
        statusChangedAt: createdAt,
        createdAt,
      }),
    ]);
  });

  it("leaves a transmission through the shared access point pending for the poll, on the document's network", () => {
    const [row] = buildHistoricalDeliveries(
      document({ id: "doc_2", accessPointProvider: "at-shared-ap-fr", apTransactionId: "tx-1", useTestNetwork: true })
    );
    expect(row).toMatchObject({
      status: "pending",
      provider: "at-shared-ap-fr",
      providerTransactionId: "tx-1",
      useTestNetwork: true,
    });
  });

  it("marks a simulated send delivered even for a company on the shared access point", () => {
    const [row] = buildHistoricalDeliveries(document({ id: "doc_3", accessPointProvider: "at-shared-ap-fr" }));
    expect(row).toMatchObject({ status: "delivered", provider: null, providerTransactionId: null });
  });

  it("marks a refused transmission that fell back to email failed, with one pending email delivery per address", () => {
    const rows = buildHistoricalDeliveries(
      document({ id: "doc_4", sentOverPeppol: false, emailRecipients: ["b@example.com", "c@example.com"] })
    );
    expect(rows.map((row) => [row.channel, row.address, row.status, row.failureCategory ?? null])).toEqual([
      ["peppol", "0208:1", "failed", "other"],
      ["email", "b@example.com", "pending", null],
      ["email", "c@example.com", "pending", null],
    ]);
  });

  it("creates only email deliveries for a document that was never addressed on the network", () => {
    const rows = buildHistoricalDeliveries(
      document({ id: "doc_5", receiverId: null, sentOverPeppol: false, emailRecipients: ["d@example.com"] })
    );
    expect(rows.map((row) => row.channel)).toEqual(["email"]);
  });
});

/**
 * An in-memory store with the same selection rule as the database one: outgoing
 * documents in id order after the cursor that have no deliveries yet. A document in
 * `locked` is held by another transaction: a batch skips it, as `SKIP LOCKED` does,
 * while the read that waits for nobody still sees it.
 */
function fakeStore(
  documents: HistoricalOutgoingDocument[],
  failOnBatch?: number,
  locked: Set<string> = new Set()
) {
  const deliveries: { transmittedDocumentId: string; channel: string }[] = [];
  const batches: string[][] = [];
  const remainingChecks: boolean[] = [];
  const uncovered = () => {
    const withDeliveries = new Set(deliveries.map((delivery) => delivery.transmittedDocumentId));
    return documents.filter((candidate) => !withDeliveries.has(candidate.id));
  };
  const store: BackfillStore = {
    async hasRemaining() {
      const remaining = uncovered().length > 0;
      remainingChecks.push(remaining);
      return remaining;
    },

    async processBatch(afterId, limit) {
      const withDeliveries = new Set(deliveries.map((delivery) => delivery.transmittedDocumentId));
      const batch = documents
        .filter(
          (candidate) =>
            candidate.id > afterId && !withDeliveries.has(candidate.id) && !locked.has(candidate.id)
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit);
      batches.push(batch.map((candidate) => candidate.id));
      if (failOnBatch !== undefined && batches.length === failOnBatch) {
        throw new Error("batch rolled back");
      }
      if (batch.length === 0) {
        return { documents: 0, deliveries: 0, lastId: null };
      }
      const rows = batch.flatMap(buildHistoricalDeliveries);
      deliveries.push(...rows.map((row) => ({ transmittedDocumentId: row.transmittedDocumentId, channel: row.channel })));
      return { documents: batch.length, deliveries: rows.length, lastId: batch.at(-1)!.id };
    },
  };
  return { store, deliveries, batches, remainingChecks };
}

describe("the delivery backfill job", () => {
  const documents = [
    document({ id: "doc_01" }),
    document({ id: "doc_02", accessPointProvider: "at-shared-ap-fr", apTransactionId: "tx-2" }),
    document({ id: "doc_03", sentOverPeppol: false, emailRecipients: ["a@example.com"] }),
    document({ id: "doc_04", receiverId: null, sentOverPeppol: false, emailRecipients: ["b@example.com"] }),
    document({ id: "doc_05" }),
  ];

  it("walks the documents in bounded batches after the cursor and stops when a full pass writes nothing", async () => {
    const { store, deliveries, batches } = fakeStore(documents);
    const state = initialBackfillState();

    const progress = await runDeliveryBackfill(store, state, { batchSize: 2 });

    expect(progress).toEqual({ documents: 5, deliveries: 6, finished: true });
    expect(deliveries).toHaveLength(6);
    // Three batches of work, the end of the first pass, then one empty pass that
    // proves nothing is left.
    expect(batches).toEqual([
      ["doc_01", "doc_02"],
      ["doc_03", "doc_04"],
      ["doc_05"],
      [],
      [],
    ]);
    expect(state.finished).toBe(true);
  });

  it("adds nothing when run again", async () => {
    const { store, deliveries } = fakeStore(documents);
    await runDeliveryBackfill(store, initialBackfillState(), { batchSize: 2 });
    const before = deliveries.length;

    const again = await runDeliveryBackfill(store, initialBackfillState(), { batchSize: 2 });

    expect(again).toEqual({ documents: 0, deliveries: 0, finished: true });
    expect(deliveries).toHaveLength(before);
  });

  it("only touches documents that have no deliveries yet", async () => {
    const { store, deliveries } = fakeStore(documents);
    // A document recorded after the deploy already has its deliveries.
    deliveries.push({ transmittedDocumentId: "doc_03", channel: "peppol" });

    await runDeliveryBackfill(store, initialBackfillState(), { batchSize: 10 });

    expect(deliveries.filter((delivery) => delivery.transmittedDocumentId === "doc_03")).toHaveLength(1);
    expect(new Set(deliveries.map((delivery) => delivery.transmittedDocumentId))).toEqual(
      new Set(["doc_01", "doc_02", "doc_03", "doc_04", "doc_05"])
    );
  });

  it("stops at the deadline and continues from its cursor on the next run", async () => {
    const { store, deliveries } = fakeStore(documents);
    const state = initialBackfillState();
    let ticks = 0;
    const now = () => new Date(2026, 0, 1, 0, 0, ticks++);

    const first = await runDeliveryBackfill(store, state, {
      batchSize: 2,
      now,
      deadline: new Date(2026, 0, 1, 0, 0, 2),
    });
    expect(first.finished).toBe(false);
    expect(first.documents).toBe(4);
    expect(state.cursor).toBe("doc_04");

    const second = await runDeliveryBackfill(store, state, { batchSize: 2 });
    expect(second).toEqual({ documents: 1, deliveries: 1, finished: true });
    expect(deliveries).toHaveLength(6);
  });

  it("keeps going while a document another transaction holds is still uncovered, and covers it once the lock is gone", async () => {
    // A pass that writes nothing is not proof that nothing is left: the batch skips
    // a locked row rather than waiting for it, so the read that waits for nobody is
    // what decides whether the job is done.
    const locked = new Set(["doc_05"]);
    const { store, deliveries, remainingChecks } = fakeStore(documents, undefined, locked);
    const state = initialBackfillState();

    const held = await runDeliveryBackfill(store, state, { batchSize: 2 });

    expect(held.finished).toBe(false);
    expect(state.finished).toBe(false);
    expect(remainingChecks.at(-1)).toBe(true);
    expect(deliveries.map((delivery) => delivery.transmittedDocumentId)).not.toContain("doc_05");

    locked.clear();
    const released = await runDeliveryBackfill(store, state, { batchSize: 2 });

    expect(released.documents).toBe(1);
    expect(released.finished).toBe(true);
    expect(new Set(deliveries.map((delivery) => delivery.transmittedDocumentId))).toEqual(
      new Set(["doc_01", "doc_02", "doc_03", "doc_04", "doc_05"])
    );
  });

  it("picks up a batch that rolled back on the next pass", async () => {
    const { store, deliveries } = fakeStore(documents, 2);
    const state = initialBackfillState();

    await expect(runDeliveryBackfill(store, state, { batchSize: 2 })).rejects.toThrow("batch rolled back");
    expect(state.cursor).toBe("doc_02");

    const resumed = await runDeliveryBackfill(store, state, { batchSize: 2 });
    expect(resumed.finished).toBe(true);
    expect(new Set(deliveries.map((delivery) => delivery.transmittedDocumentId))).toEqual(
      new Set(["doc_01", "doc_02", "doc_03", "doc_04", "doc_05"])
    );
  });
});
