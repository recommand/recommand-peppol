import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fetchArratechJson } from "../data/at/client";

// A request to the access point is bounded by the signal the caller passes, and the
// bound has to cover reading the response body: a response whose body never ends
// leaves the read pending, and the serial poll behind it would wait forever.

const realFetch = globalThis.fetch;
const environment = {
  ARRATECH_API_URL: "https://provider.invalid",
  ARRATECH_API_KEY: "key",
  ARRATECH_ORG_ID: "org-1",
  ARRATECH_SMP_REF: "smp",
  ARRATECH_AP_REF: "ap",
};
const previous: Record<string, string | undefined> = {};

/** A response whose headers arrived and whose body never does. */
function trickling(ok: boolean): Response {
  const never = new Promise<never>(() => {});
  return {
    ok,
    statusText: "OK",
    json: () => never,
    text: () => never,
  } as unknown as Response;
}

beforeAll(() => {
  for (const [name, value] of Object.entries(environment)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
});

afterAll(() => {
  globalThis.fetch = realFetch;
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("a request to the access point with a deadline", () => {
  it("gives up when the response body never ends", async () => {
    globalThis.fetch = (async () => trickling(true)) as unknown as typeof fetch;

    await expect(
      fetchArratechJson("/orgs/org-1/transactions/tx-1", {
        method: "GET",
        useTestNetwork: false,
        signal: AbortSignal.timeout(20),
      })
    ).rejects.toThrow(/timed out|aborted/i);
  });

  it("gives up on an error response whose body never ends either", async () => {
    globalThis.fetch = (async () => trickling(false)) as unknown as typeof fetch;

    await expect(
      fetchArratechJson("/orgs/org-1/transactions/tx-1", {
        method: "GET",
        useTestNetwork: false,
        signal: AbortSignal.timeout(20),
      })
    ).rejects.toThrow(/timed out|aborted/i);
  });

  it("returns the body of a response that arrives in time", async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ transactionStatus: "COMPLETED" }) }) as unknown as Response) as unknown as typeof fetch;

    expect(
      await fetchArratechJson<{ transactionStatus: string }>("/orgs/org-1/transactions/tx-1", {
        method: "GET",
        useTestNetwork: false,
        signal: AbortSignal.timeout(1_000),
      })
    ).toEqual({ transactionStatus: "COMPLETED" });
  });

  it("waits as long as it takes when the caller sets no deadline", async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ transactionStatus: "COMPLETED" }) }) as unknown as Response) as unknown as typeof fetch;

    expect(
      await fetchArratechJson<{ transactionStatus: string }>("/orgs/org-1/transactions/tx-1", {
        method: "GET",
        useTestNetwork: false,
      })
    ).toEqual({ transactionStatus: "COMPLETED" });
  });
});
