import { describe, expect, it, mock } from "bun:test";

// The reconciliation poll asks the access point about a pending delivery and hands
// the answer to the same report application the webhook uses, so everything that
// follows a failure, the event and the email fallback included, happens for a
// failure the poll discovered just as for one the webhook reported.

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

const applied: unknown[] = [];
const checked: string[] = [];

mock.module("@recommand/db", () => ({
  db: {
    select: () =>
      chain([
        { id: "dlv_1", providerTransactionId: "tx-1", useTestNetwork: false },
        { id: "dlv_2", providerTransactionId: "tx-2", useTestNetwork: true },
      ]),
    update: () => ({ set: () => ({ where: async () => { checked.push("checked"); } }) }),
  },
}));
mock.module("@peppol/data/at/client", () => ({
  getArratechConfig: (useTestNetwork: boolean) => ({ orgId: useTestNetwork ? "org-test" : "org-prod" }),
  fetchArratechJson: async (path: string) =>
    path.includes("tx-1")
      ? { transactionStatus: "FAILED", serviceError: { code: "TXE-1005", message: "Schematron failed", category: "VALIDATION_ERROR" } }
      : { transactionStatus: "COMPLETED_NO_DELIVERY" },
}));
const model = await import("../../data/deliveries/model");
mock.module("@peppol/data/deliveries", () => ({
  ...model,
  applyProviderDeliveryReport: async (report: unknown) => {
    applied.push(report);
    return "applied";
  },
  pruneStagedDeliveryReports: async () => 0,
}));

const { reconcilePendingArratechDeliveries } = await import("../../data/deliveries/reconcile");

describe("the reconciliation poll", () => {
  it("applies what the access point answers through the same path as the webhook", async () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {} } as never;

    const progress = await reconcilePendingArratechDeliveries(logger);

    expect(progress).toEqual({ checked: 2, applied: 1 });
    expect(applied).toEqual([
      {
        channel: "peppol",
        provider: "at-shared-ap-fr",
        providerTransactionId: "tx-1",
        useTestNetwork: false,
        status: "failed",
        failure: { category: "validation", message: "Schematron failed", providerCode: "TXE-1005" },
        eventId: null,
        eventType: null,
        payload: expect.objectContaining({ transactionStatus: "FAILED" }),
      },
    ]);
    // Both deliveries were asked about; the unsettled one stays pending untouched.
    expect(checked).toHaveLength(2);
  });
});
