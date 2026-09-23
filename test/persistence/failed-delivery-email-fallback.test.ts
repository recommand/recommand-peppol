import { beforeEach, describe, expect, it, mock } from "bun:test";

// A provider report is applied against a fake of the database so the failure path
// can be followed end to end: the conditional update, the event, and the email
// fallback that a failed Peppol delivery triggers. The webhook and the
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

let found: Row | undefined;
let updated: Row | undefined;
const published: Row[] = [];
const fallbacks: string[] = [];

mock.module("@recommand/db", () => ({
  db: {
    select: () => chain(found ? [found] : []),
    insert: () => chain([]),
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
mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: async () => {} }));
mock.module("@peppol/data/deliveries/email-fallback-db", () => ({
  runEmailFallbackForDocument: async (documentId: string) => {
    fallbacks.push(documentId);
    return { kind: "none" };
  },
}));

const { applyProviderDeliveryReport } = await import("../../data/deliveries");

const delivery = {
  id: "dlv_1",
  transmittedDocumentId: "doc_1",
  teamId: "team_1",
  companyId: "cmp_1",
  channel: "peppol",
  address: "0208:987654321",
  status: "pending",
  provider: "at-shared-ap-fr",
  providerTransactionId: "tx-1",
};
const document = { id: "doc_1", type: "invoice", senderId: "0225:1", receiverId: "0208:987654321", envelopeId: "env-1" };

function report(status: "failed" | "delivered") {
  return {
    channel: "peppol" as const,
    provider: "at-shared-ap-fr",
    providerTransactionId: "tx-1",
    useTestNetwork: false,
    status,
    failure: status === "failed" ? { category: "validation" as const, message: "Schematron failed", providerCode: "TXE-1005" } : null,
    eventId: "evt-1",
    eventType: "transaction.send_failed",
    payload: {},
  };
}

beforeEach(() => {
  found = { delivery, document };
  updated = { ...delivery, status: "failed" };
  published.length = 0;
  fallbacks.length = 0;
});

describe("a failure report on a pending Peppol delivery", () => {
  it("fails the delivery, tells the owner once, and then sends the email fallback", async () => {
    expect(await applyProviderDeliveryReport(report("failed"))).toBe("applied");

    expect(published.map((event) => event.type)).toEqual(["peppol.document.delivery_status.v1"]);
    expect(published[0]!.payload).toMatchObject({ deliveryId: "dlv_1", status: "failed", previousStatus: "pending" });
    expect(fallbacks).toEqual(["doc_1"]);
  });

  it("sends no fallback when another caller moved the delivery first", async () => {
    // The conditional update found the delivery no longer pending.
    updated = undefined;

    expect(await applyProviderDeliveryReport(report("failed"))).toBe("unchanged");
    expect(published).toEqual([]);
    expect(fallbacks).toEqual([]);
  });

  it("sends no fallback when the delivery is already final", async () => {
    found = { delivery: { ...delivery, status: "delivered" }, document };

    expect(await applyProviderDeliveryReport(report("failed"))).toBe("unchanged");
    expect(fallbacks).toEqual([]);
  });

  it("sends no fallback on a confirmation", async () => {
    updated = { ...delivery, status: "delivered" };

    expect(await applyProviderDeliveryReport(report("delivered"))).toBe("applied");
    expect(published[0]!.payload).toMatchObject({ status: "delivered" });
    expect(fallbacks).toEqual([]);
  });
});
