import { beforeEach, describe, expect, it, mock } from "bun:test";

// A mail service report is applied against a fake of the database so the matching
// can be followed: the delivery named in the message's metadata is found first, the
// message id is the fallback, a final delivery is never moved, and a report for a
// delivery that is not written yet is kept for it. The webhook and the email
// reconciliation poll both apply reports through this one function.

type Row = Record<string, unknown>;

/** A query builder that accepts any chain of calls and resolves to `result`. */
function chain(result: unknown): any {
  const proxy: any = new Proxy(() => proxy, {
    get(_target, property) {
      if (property === "then") {
        return (resolve: (value: unknown) => void) => resolve(result);
      }
      return () => proxy;
    },
  });
  return proxy;
}

// Each select answers with the next queued result, in the order the model asks:
// the delivery by id, the delivery by provider reference, then the staged report.
let selects: unknown[][] = [];
let updated: Row | undefined;
const inserted: Row[] = [];
const published: Row[] = [];
const alerts: string[] = [];

mock.module("@recommand/db", () => ({
  db: {
    select: () => chain(selects.shift() ?? []),
    insert: () => ({
      values: (row: Row) => {
        inserted.push(row);
        return chain([]);
      },
    }),
    delete: () => chain([]),
    transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({ update: () => chain(updated ? [updated] : []) }),
  },
}));
mock.module("@core/data/rules/events", () => ({
  publishEvent: async (type: string, args: Row) => {
    published.push({ type, ...args });
  },
}));
mock.module("@core/lib/audit", () => ({ writeAuditEvent: async () => {} }));
mock.module("@peppol/utils/system-notifications/telegram", () => ({
  sendSystemAlert: async (title: string) => {
    alerts.push(title);
  },
}));
mock.module("@peppol/data/deliveries/email-fallback-db", () => ({
  runEmailFallbackForDocument: async () => ({ kind: "none" }),
}));

const { applyProviderDeliveryReport } = await import("../../data/deliveries");

const delivery = {
  id: "dlv_1",
  transmittedDocumentId: "doc_1",
  teamId: "team_1",
  companyId: "cmp_1",
  channel: "email",
  address: "john@example.com",
  status: "pending",
  provider: "postmark",
  providerTransactionId: "msg-1",
};
const document = { id: "doc_1", type: "invoice", senderId: "0225:1", receiverId: null, envelopeId: null };

function report(status: "failed" | "delivered", overrides: Row = {}) {
  return {
    channel: "email" as const,
    provider: "postmark",
    providerTransactionId: "msg-1",
    deliveryId: "dlv_1",
    useTestNetwork: false,
    status,
    failure: status === "failed" ? { category: "recipient_not_found" as const, message: "Mailbox not found", providerCode: "HardBounce" } : null,
    eventId: "1",
    eventType: status === "failed" ? "Bounce" : "Delivery",
    payload: {},
    ...overrides,
  };
}

beforeEach(() => {
  selects = [];
  updated = undefined;
  inserted.length = 0;
  published.length = 0;
  alerts.length = 0;
});

describe("a mail service report", () => {
  it("finds the delivery by the id the message carried and confirms it once", async () => {
    selects = [[{ delivery, document }]];
    updated = { ...delivery, status: "delivered" };

    expect(await applyProviderDeliveryReport(report("delivered"))).toBe("applied");

    expect(published.map((event) => event.type)).toEqual(["peppol.document.delivery_status.v1"]);
    expect(published[0]!.payload).toMatchObject({
      deliveryId: "dlv_1",
      channel: "email",
      address: "john@example.com",
      status: "delivered",
      previousStatus: "pending",
    });
    expect(inserted).toEqual([]);
  });

  it("fails the delivery on a bounce with the bounce's reason, and sends no email fallback", async () => {
    selects = [[{ delivery, document }]];
    updated = { ...delivery, status: "failed" };

    expect(await applyProviderDeliveryReport(report("failed"))).toBe("applied");

    expect(published[0]!.payload).toMatchObject({
      status: "failed",
      failure: { category: "recipient_not_found", providerCode: "HardBounce" },
    });
    expect(alerts).toEqual(["Document Delivery Failed"]);
  });

  it("falls back to the message id when the named delivery belongs to another provider or message", async () => {
    // The id in the metadata names a Peppol delivery: not trusted, the message id decides.
    selects = [[{ delivery: { ...delivery, provider: "at-shared-ap-fr", channel: "peppol" }, document }], [{ delivery, document }]];
    updated = { ...delivery, status: "delivered" };

    expect(await applyProviderDeliveryReport(report("delivered"))).toBe("applied");
    expect(published).toHaveLength(1);
  });

  it("accepts the named delivery when it never got a message id", async () => {
    selects = [[{ delivery: { ...delivery, providerTransactionId: null }, document }]];
    updated = { ...delivery, status: "delivered" };

    expect(await applyProviderDeliveryReport(report("delivered"))).toBe("applied");
  });

  it("never moves a delivery that is already final: a bounce after a delivery changes nothing", async () => {
    selects = [[{ delivery: { ...delivery, status: "delivered" }, document }]];

    expect(await applyProviderDeliveryReport(report("failed"))).toBe("unchanged");
    expect(published).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it("never moves a delivery that is already final: a delivery after a bounce changes nothing", async () => {
    selects = [[{ delivery: { ...delivery, status: "failed" }, document }]];

    expect(await applyProviderDeliveryReport(report("delivered"))).toBe("unchanged");
    expect(published).toEqual([]);
  });

  it("treats a repeated report as a no-op, also when it lost the race to move the delivery", async () => {
    // Read pending, but the conditional update found it moved in the meantime.
    selects = [[{ delivery, document }]];
    updated = undefined;

    expect(await applyProviderDeliveryReport(report("delivered"))).toBe("unchanged");
    expect(published).toEqual([]);
  });

  it("keeps a report for a delivery that is not written yet, under the provider's reference", async () => {
    selects = [[], [], [{ provider: "postmark", providerTransactionId: "msg-1", status: "delivered", payload: {} }], []];

    expect(await applyProviderDeliveryReport(report("delivered"))).toBe("staged");

    expect(inserted).toEqual([
      expect.objectContaining({ provider: "postmark", providerTransactionId: "msg-1", channel: "email", status: "delivered" }),
    ]);
    expect(published).toEqual([]);
    expect(alerts).toEqual(["Delivery Report For Unrecorded Transaction"]);
  });
});
