import { describe, expect, it, mock } from "bun:test";

// A delivery the access point has not settled a week after accepting it is reported
// once and no longer asked about. It keeps its status: nothing is known about it.

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

let expired: unknown[] = [];
const updates: unknown[] = [];
const alerts: { title: string; message: string; level: string }[] = [];
const warnings: string[] = [];

mock.module("@recommand/db", () => ({
  db: {
    select: () => chain(expired),
    update: () => ({
      set: (patch: unknown) => ({
        where: async () => {
          updates.push(patch);
        },
      }),
    }),
  },
}));
mock.module("@peppol/utils/system-notifications/telegram", () => ({
  sendSystemAlert: async (title: string, message: string, level: string) => {
    alerts.push({ title, message, level });
  },
}));
mock.module("@peppol/data/at/client", () => ({
  getArratechConfig: () => ({ orgId: "org" }),
  fetchArratechJson: async () => ({}),
}));
mock.module("@peppol/data/deliveries", () => ({
  applyProviderDeliveryReport: async () => "applied",
  drainStagedDeliveryReports: async () => 0,
  pruneStagedDeliveryReports: async () => 0,
  interpretArratechTransactionStatus: () => null,
}));
mock.module("@peppol/data/deliveries/email-fallback-db", () => ({
  resumeStalledEmailFallbacks: async () => ({ found: 0, resumed: 0 }),
}));

const { stopReconcilingExpiredDeliveries } = await import("../../data/deliveries/reconcile");
const logger = {
  info: () => {},
  warn: (message: string) => {
    warnings.push(message);
  },
  error: () => {},
} as never;

describe("giving up on deliveries the access point never settles", () => {
  it("marks them, reports them once and leaves their status alone", async () => {
    expired = [
      { id: "dlv_1", providerTransactionId: "tx-1" },
      { id: "dlv_2", providerTransactionId: "tx-2" },
    ];
    const now = new Date("2026-09-15T08:00:00Z");

    const count = await stopReconcilingExpiredDeliveries(logger, now);

    expect(count).toBe(2);
    expect(updates).toEqual([{ reconciliationEndedAt: now }]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toBe("Delivery Reconciliation Stopped");
    expect(alerts[0]!.level).toBe("warning");
    expect(alerts[0]!.message).toContain("dlv_1 (transaction tx-1)");
    expect(alerts[0]!.message).toContain("dlv_2 (transaction tx-2)");
    expect(warnings).toHaveLength(1);
  });

  it("does nothing, and says nothing, when no delivery has expired", async () => {
    expired = [];
    updates.length = 0;
    alerts.length = 0;
    warnings.length = 0;

    const count = await stopReconcilingExpiredDeliveries(logger);

    expect(count).toBe(0);
    expect(updates).toEqual([]);
    expect(alerts).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
