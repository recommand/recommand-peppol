import { afterEach, describe, expect, it, mock } from "bun:test";

// The reconciliation poll asks the access point about deliveries it never reported
// on, one after the other. What is under test here is what the loop does when a
// single item misbehaves: the provider hangs, or the note that the delivery was
// checked cannot be written. Neither may cost the rest of the batch, and the tick
// must still get to the work that follows the poll.

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

const due = [
  { id: "dlv_1", providerTransactionId: "tx-1", useTestNetwork: false },
  { id: "dlv_2", providerTransactionId: "tx-2", useTestNetwork: false },
  { id: "dlv_3", providerTransactionId: "tx-3", useTestNetwork: false },
];

const checked: string[] = [];
const requested: string[] = [];
const applied: string[] = [];
const pruned: number[] = [];
const resumed: number[] = [];
let failCheckNoteFor: string[] = [];
let notes = 0;
let respond: (transactionId: string, signal: AbortSignal | null | undefined) => Promise<unknown> =
  async () => ({ transactionStatus: "COMPLETED" });

mock.module("@recommand/db", () => ({
  db: {
    select: () => chain(due),
    update: () => ({
      set: () => ({
        // The loop is serial, so the note being written is the one for the delivery
        // the poll has just dealt with.
        where: async () => {
          const id = due[notes++]!.id;
          if (failCheckNoteFor.includes(id)) {
            throw new Error(`could not note ${id}`);
          }
          checked.push(id);
        },
      }),
    }),
  },
}));
mock.module("@peppol/data/at/client", () => ({
  getArratechConfig: () => ({ orgId: "org-1" }),
  fetchArratechJson: async (path: string, options: { signal?: AbortSignal | null }) => {
    const transactionId = path.split("/").at(-1)!;
    requested.push(transactionId);
    return await respond(transactionId, options.signal);
  },
}));
const model = await import("../data/deliveries/model");
mock.module("@peppol/data/deliveries", () => ({
  ...model,
  applyProviderDeliveryReport: async (report: { providerTransactionId: string }) => {
    applied.push(report.providerTransactionId);
    return "applied";
  },
  pruneStagedDeliveryReports: async () => {
    pruned.push(1);
    return 1;
  },
}));
mock.module("@peppol/data/deliveries/email-fallback-db", () => ({
  resumeStalledEmailFallbacks: async () => {
    resumed.push(1);
    return { found: 1, resumed: 1 };
  },
}));

const { reconcilePendingArratechDeliveries, runDeliveryReconciliationTick } = await import(
  "../data/deliveries/reconcile"
);

const errors: string[] = [];
const logger = {
  info: () => {},
  warn: () => {},
  error: (message: string) => errors.push(message),
} as never;

afterEach(() => {
  checked.length = 0;
  requested.length = 0;
  applied.length = 0;
  pruned.length = 0;
  resumed.length = 0;
  errors.length = 0;
  failCheckNoteFor = [];
  notes = 0;
  respond = async () => ({ transactionStatus: "COMPLETED" });
});

describe("a delivery whose check cannot be noted", () => {
  it("is logged and left for the next tick, and the rest of the batch is still asked about", async () => {
    failCheckNoteFor = ["dlv_1"];

    const result = await reconcilePendingArratechDeliveries(logger, new Date(), {
      requestTimeoutMs: 50,
    });

    expect(requested).toEqual(["tx-1", "tx-2", "tx-3"]);
    expect(applied).toEqual(["tx-1", "tx-2", "tx-3"]);
    expect(result).toEqual({ checked: 3, applied: 3 });
    // Only the deliveries whose note was written are marked checked.
    expect(checked).toEqual(["dlv_2", "dlv_3"]);
    expect(errors).toEqual([expect.stringContaining("Could not note the check of delivery dlv_1")]);
  });

  it("does not keep the tick from the work that follows the poll", async () => {
    failCheckNoteFor = ["dlv_1", "dlv_2", "dlv_3"];

    await runDeliveryReconciliationTick(logger);

    expect(requested).toHaveLength(3);
    expect(pruned).toEqual([1]);
    expect(resumed).toEqual([1]);
  });
});

describe("a provider that never answers", () => {
  it("gives up on that delivery when its deadline passes and carries on with the rest", async () => {
    respond = (transactionId, signal) =>
      transactionId === "tx-1"
        ? new Promise((_resolve, reject) => {
            // What the client's deadline does: reject as soon as the signal aborts,
            // however long the provider would have taken.
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          })
        : Promise.resolve({ transactionStatus: "COMPLETED" });

    const result = await reconcilePendingArratechDeliveries(logger, new Date(), {
      requestTimeoutMs: 20,
    });

    expect(requested).toEqual(["tx-1", "tx-2", "tx-3"]);
    expect(applied).toEqual(["tx-2", "tx-3"]);
    expect(result).toEqual({ checked: 3, applied: 2 });
    // The delivery that timed out is noted as checked, so it waits its turn again.
    expect(checked).toEqual(["dlv_1", "dlv_2", "dlv_3"]);
    expect(errors).toEqual([expect.stringContaining("Could not reconcile delivery dlv_1")]);
  });

  it("is asked with a deadline even when the caller names none", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    respond = async (_transactionId, signal) => {
      signals.push(signal);
      return { transactionStatus: "COMPLETED" };
    };

    await reconcilePendingArratechDeliveries(logger);

    expect(signals).toHaveLength(3);
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal!.aborted).toBe(false);
    }
  });
});
