import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";

const productionSecret = "production-" + crypto.randomUUID();
const testSecret = "test-" + crypto.randomUUID();
const productionAp = "ap-production";
const testAp = "ap-test";

const reports: unknown[] = [];
const sent: unknown[] = [];
let sentOutcome = "sent-by-us";

mock.module("@recommand/lib/api", () => ({ Server: Hono }));
mock.module("@recommand/lib/utils", () => ({
  actionSuccess: (value: unknown) => ({ success: true, ...(value as object) }),
  actionFailure: (value: unknown) => ({ success: false, error: String(value) }),
}));
mock.module("@directory/utils/util", () => ({ UserFacingError: class extends Error {} }));
mock.module("@peppol/db/schema", () => ({ transmittedDocuments: { id: "id", apTransactionId: "ap", direction: "direction" } }));
mock.module("@recommand/db", () => ({ db: {} }));
mock.module("@peppol/data/at/ap", () => ({ downloadBusinessDocument: async () => null }));
mock.module("@peppol/data/at/client", () => ({
  getArratechConfig: (useTestNetwork: boolean) => ({ apRef: useTestNetwork ? testAp : productionAp }),
}));
mock.module("@peppol/data/provider-sent", () => ({
  recordProviderSentTransaction: async (transaction: unknown) => {
    sent.push(transaction);
    return sentOutcome;
  },
}));
// The webhook only interprets the report; what it does to a delivery is the model's
// business and is tested there. The interpretation itself is the real one.
const model = await import("../../data/deliveries/model");
mock.module("@peppol/data/deliveries", () => ({
  ...model,
  applyProviderDeliveryReport: async (report: unknown) => {
    reports.push(report);
    return "applied";
  },
}));
mock.module("@peppol/utils/pipelines/receiving", () => ({ receivingPipeline: async () => {} }));

const { default: server } = await import("../../api/internal/arratech-webhook");

const failedPayload = {
  id: "tx-1",
  transactionStatus: "FAILED",
  createdAt: "2026-09-09T10:00:00Z",
  apId: productionAp,
  docInstanceId: "env-1",
  serviceError: {
    code: "TXE-1005",
    message: "The document could not be delivered to the recipient.",
    category: "TRANSPORT_ERROR",
  },
};

async function post(body: object, secret: string | null) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (secret !== null) {
    headers["x-arratech-webhook-sign"] = createHmac("sha256", secret).update(raw).digest("hex");
  }
  const response = await server.request("/arratech", { method: "POST", body: raw, headers });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function event(payload: object, eventType = "transaction.send_failed") {
  return { id: "evt-1", eventType, payload };
}

beforeEach(() => {
  reports.length = 0;
  sent.length = 0;
  sentOutcome = "sent-by-us";
  process.env.ARRATECH_WEBHOOK_SECRET = productionSecret;
  process.env.ARRATECH_TEST_WEBHOOK_SECRET = testSecret;
});

describe("transaction.send_failed", () => {
  it("fails the transaction's delivery with the provider's error mapped to a category", async () => {
    const result = await post(event(failedPayload), productionSecret);

    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("applied");
    expect(reports).toEqual([
      {
        channel: "peppol",
        provider: "at-shared-ap-fr",
        providerTransactionId: "tx-1",
        useTestNetwork: false,
        status: "failed",
        failure: {
          category: "transport",
          message: "The document could not be delivered to the recipient.",
          providerCode: "TXE-1005",
        },
        eventId: "evt-1",
        eventType: "transaction.send_failed",
        payload: failedPayload,
      },
    ]);
    expect(sent).toEqual([]);
  });

  it("accepts a failure without error details or addressing, which the provider omits rather than nulls", async () => {
    const result = await post(event({ id: "tx-2", transactionStatus: "REJECTED", createdAt: "2026-09-09T10:00:00Z", apId: productionAp }), productionSecret);

    expect(result.status).toBe(200);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      providerTransactionId: "tx-2",
      status: "failed",
      failure: { category: "other", message: null, providerCode: null },
    });
  });

  it("takes the network from the signature when the access point is omitted", async () => {
    const { apId: _omitted, ...withoutAp } = failedPayload;

    const production = await post(event(withoutAp), productionSecret);
    const test = await post(event(withoutAp), testSecret);

    expect(production.status).toBe(200);
    expect(test.status).toBe(200);
    expect(reports.map((report) => (report as { useTestNetwork: boolean }).useTestNetwork)).toEqual([false, true]);
  });

  it("refuses to guess the network when both secrets match and no access point is reported", async () => {
    process.env.ARRATECH_TEST_WEBHOOK_SECRET = productionSecret;
    const { apId: _omitted, ...withoutAp } = failedPayload;

    const result = await post(event(withoutAp), productionSecret);

    expect(result.status).toBe(400);
    expect(reports).toEqual([]);
  });

  it("requires the signature to belong to the reported access point's network", async () => {
    const result = await post(event({ ...failedPayload, apId: testAp }), productionSecret);

    expect(result.status).toBe(401);
    expect(reports).toEqual([]);
  });

  it("ignores a failure for an access point that is not ours", async () => {
    const result = await post(event({ ...failedPayload, apId: "someone-elses-ap" }), productionSecret);

    expect(result.status).toBe(200);
    expect(reports).toEqual([]);
  });

  it("rejects a failure without a transaction id", async () => {
    const { id: _omitted, ...withoutId } = failedPayload;

    const result = await post(event(withoutId), productionSecret);

    expect(result.status).toBe(400);
    expect(reports).toEqual([]);
  });

  it("rejects an unsigned or wrongly signed report", async () => {
    expect((await post(event(failedPayload), null)).status).toBe(401);
    expect((await post(event(failedPayload), "not-a-secret")).status).toBe(401);
    expect(reports).toEqual([]);
  });
});

describe("other transaction events", () => {
  it("still ignores event types it does not handle, including inbound failures", async () => {
    for (const eventType of ["transaction.receive_failed", "mls.received", "webhooks.test"]) {
      const result = await post(event(failedPayload, eventType), productionSecret);
      expect(result.status).toBe(200);
      expect(result.body.message).toBe("Event type not processed");
    }
    expect(reports).toEqual([]);
    expect(sent).toEqual([]);
  });

  const completedPayload = {
    id: "tx-3",
    apId: productionAp,
    senderId: "0225:123456789",
    receiverId: "0208:0123456789",
    docTypeId: "doc-type",
    processId: "process",
    transactionStatus: "COMPLETED",
    docInstanceId: "env-3",
  };

  it("confirms the delivery of our own send when its transaction completes", async () => {
    const result = await post(event({ ...completedPayload }, "transaction.sent"), productionSecret);

    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("sent-by-us");
    expect(result.body.delivery).toBe("applied");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ apTransactionId: "tx-3", useTestNetwork: false, docInstanceId: "env-3" });
    expect(reports).toEqual([
      {
        channel: "peppol",
        provider: "at-shared-ap-fr",
        providerTransactionId: "tx-3",
        useTestNetwork: false,
        status: "delivered",
        failure: null,
        eventId: "evt-1",
        eventType: "transaction.sent",
        payload: completedPayload,
      },
    ]);
  });

  it("confirms the delivery of a document the provider sent on our behalf just the same", async () => {
    sentOutcome = "recorded";
    const result = await post(event({ ...completedPayload, id: "tx-5" }, "transaction.sent"), productionSecret);

    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("recorded");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ providerTransactionId: "tx-5", status: "delivered" });
  });

  it("does not turn a transaction.sent that is not completed into a failure", async () => {
    const payload = {
      id: "tx-4",
      apId: productionAp,
      senderId: "0225:123456789",
      receiverId: "0208:0123456789",
      docTypeId: "doc-type",
      processId: "process",
      transactionStatus: "FAILED",
    };

    const result = await post(event(payload, "transaction.sent"), productionSecret);

    expect(result.status).toBe(200);
    expect(result.body.message).toBe("Transaction not completed");
    expect(sent).toEqual([]);
    expect(reports).toEqual([]);
  });
});
