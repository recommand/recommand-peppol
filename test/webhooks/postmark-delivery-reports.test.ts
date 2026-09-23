import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

// The webhook authenticates the request, decides whether the record concerns a
// document delivery, interprets it, and hands the report to the deliveries model.
// What the report does to a delivery is the model's business and is tested there;
// the interpretation is the real one.

const secret = "postmark-" + crypto.randomUUID();
const reports: unknown[] = [];
let outcome = "applied";

mock.module("@recommand/lib/api", () => ({ Server: Hono }));
mock.module("@recommand/lib/utils", () => ({
  actionSuccess: (value: unknown) => ({ success: true, ...(value as object) }),
  actionFailure: (value: unknown) => ({ success: false, error: String(value) }),
}));
const model = await import("../../data/deliveries/model");
mock.module("@peppol/data/deliveries", () => ({
  ...model,
  applyProviderDeliveryReport: async (report: unknown) => {
    reports.push(report);
    return outcome;
  },
}));

const { default: server, isAuthorizedPostmarkRequest } = await import("../../api/internal/postmark-webhook");

const messageId = "883953f4-6105-42a2-a16a-77a8eac79483";
const metadata = { deliveryId: "dlv_1", documentId: "doc_1" };

const delivery = {
  RecordType: "Delivery",
  ServerID: 23,
  MessageStream: "outbound",
  MessageID: messageId,
  Recipient: "john@example.com",
  Tag: "",
  DeliveredAt: "2026-09-09T16:33:54.9070259Z",
  Details: "smtp;250 2.0.0 OK",
  Metadata: metadata,
};

function bounce(type: string, typeCode: number, recordType = "Bounce") {
  return {
    RecordType: recordType,
    ID: 4323372036854775,
    Type: type,
    TypeCode: typeCode,
    Name: "Bounce",
    Tag: "",
    MessageID: messageId,
    ServerID: 23,
    MessageStream: "outbound",
    Description: "The server was unable to deliver your message.",
    Details: "smtp;550 5.1.1 The email account does not exist",
    Email: "john@example.com",
    From: "sender@example.com",
    BouncedAt: "2026-09-09T16:33:54.9070259Z",
    DumpAvailable: true,
    Inactive: true,
    CanActivate: true,
    Subject: "Invoice 1",
    Content: "<full dump of the bounce>",
    Metadata: metadata,
  };
}

function basic(username: string, password?: string) {
  const credentials = password === undefined ? username : `${username}:${password}`;
  return "Basic " + Buffer.from(credentials, "utf8").toString("base64");
}

async function post(body: unknown, headers: Record<string, string> = { authorization: basic("postmark", secret) }) {
  const response = await server.request("/postmark", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  reports.length = 0;
  outcome = "applied";
  process.env.POSTMARK_WEBHOOK_SECRET = secret;
});

describe("authentication", () => {
  it("accepts the secret as the basic auth password, whatever the username", async () => {
    expect((await post(delivery, { authorization: basic("postmark", secret) })).status).toBe(200);
    expect((await post(delivery, { authorization: basic("anything", secret) })).status).toBe(200);
  });

  it("accepts the secret as the only credential, which a URL without a password sends", async () => {
    expect((await post(delivery, { authorization: basic(secret) })).status).toBe(200);
  });

  it("accepts the secret in the custom header", async () => {
    expect((await post(delivery, { "x-postmark-webhook-secret": secret })).status).toBe(200);
  });

  it("rejects a missing, wrong or truncated secret without looking at the body", async () => {
    expect((await post(delivery, {})).status).toBe(401);
    expect((await post(delivery, { authorization: basic("postmark", "wrong-" + secret) })).status).toBe(401);
    expect((await post(delivery, { authorization: basic("postmark", secret.slice(0, -1)) })).status).toBe(401);
    expect((await post(delivery, { authorization: "Bearer " + secret })).status).toBe(401);
    expect((await post(delivery, { "x-postmark-webhook-secret": "wrong" })).status).toBe(401);
    expect(reports).toEqual([]);
  });

  it("refuses to run without a configured secret", async () => {
    delete process.env.POSTMARK_WEBHOOK_SECRET;
    expect((await post(delivery)).status).toBe(500);
    expect(reports).toEqual([]);
  });

  it("compares the whole secret", () => {
    expect(isAuthorizedPostmarkRequest({ authorization: basic("u", secret) }, secret)).toBe(true);
    expect(isAuthorizedPostmarkRequest({ authorization: basic("u", secret + "x") }, secret)).toBe(false);
    expect(isAuthorizedPostmarkRequest({ authorization: basic(secret, "") }, secret)).toBe(true);
    expect(isAuthorizedPostmarkRequest({ authorization: "Basic not-base64!" }, secret)).toBe(false);
    expect(isAuthorizedPostmarkRequest({ secretHeader: secret }, secret)).toBe(true);
    expect(isAuthorizedPostmarkRequest({}, secret)).toBe(false);
  });
});

describe("records", () => {
  it("confirms the delivery a delivered message was sent for", async () => {
    const result = await post(delivery);

    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("applied");
    expect(reports).toEqual([
      {
        channel: "email",
        provider: "postmark",
        providerTransactionId: messageId,
        deliveryId: "dlv_1",
        useTestNetwork: false,
        status: "delivered",
        failure: null,
        eventId: null,
        eventType: "Delivery",
        payload: delivery,
      },
    ]);
  });

  it.each([
    ["HardBounce", 1, "recipient_not_found"],
    ["BadEmailAddress", 100000, "recipient_not_found"],
    ["SoftBounce", 4096, "transport"],
    ["Transient", 2, "transport"],
    ["DnsError", 256, "transport"],
    ["DMARCPolicy", 100009, "transport"],
    ["SpamNotification", 512, "recipient_rejected"],
    ["Blocked", 100006, "recipient_rejected"],
    ["ManuallyDeactivated", 100002, "recipient_rejected"],
    ["Unknown", 2048, "other"],
  ])("fails the delivery of a %s bounce as %s", async (type, typeCode, category) => {
    const record = bounce(type as string, typeCode as number);
    const result = await post(record);

    expect(result.status).toBe(200);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      providerTransactionId: messageId,
      deliveryId: "dlv_1",
      status: "failed",
      failure: {
        category,
        message: "The server was unable to deliver your message. smtp;550 5.1.1 The email account does not exist",
        providerCode: type,
      },
      eventId: String(record.ID),
      eventType: "Bounce",
    });
    // The bounce dump is not kept with the delivery.
    expect((reports[0] as { payload: object }).payload).not.toHaveProperty("Content");
    expect((reports[0] as { payload: object }).payload).toHaveProperty("Type", type);
  });

  it("fails the delivery of a spam complaint as rejected by the recipient", async () => {
    await post(bounce("SpamComplaint", 100001, "SpamComplaint"));

    expect(reports[0]).toMatchObject({
      status: "failed",
      failure: { category: "recipient_rejected", providerCode: "SpamComplaint" },
      eventType: "SpamComplaint",
    });
  });

  it("acknowledges a bounce that says nothing about the outcome without touching the delivery", async () => {
    const result = await post(bounce("AutoResponder", 64));

    expect(result.status).toBe(200);
    expect(reports).toEqual([]);
  });

  it("acknowledges opens, clicks and subscription changes without reading them", async () => {
    for (const RecordType of ["Open", "Click", "SubscriptionChange", "SomethingNew"]) {
      const result = await post({ RecordType, MessageID: messageId, Metadata: metadata });
      expect(result.status).toBe(200);
    }
    expect(reports).toEqual([]);
  });

  it("acknowledges a message that was not a document delivery", async () => {
    // Postmark's own test payload, and every notification or verification mail.
    const result = await post({ ...delivery, Metadata: { example: "value", example_2: "value" } });
    expect(result.status).toBe(200);
    expect(result.body.message).toBe("Not a document delivery");

    expect((await post({ ...delivery, Metadata: undefined })).status).toBe(200);
    expect(reports).toEqual([]);
  });

  it("acknowledges a report for a delivery that is not recorded yet, which the model keeps", async () => {
    outcome = "staged";

    const result = await post(delivery);

    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("staged");
  });

  it("acknowledges a repeated report the model found nothing to change for", async () => {
    outcome = "unchanged";

    const result = await post(bounce("HardBounce", 1));

    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("unchanged");
  });

  it("rejects a body that is not a webhook record", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ MessageID: messageId })).status).toBe(400);
    expect(reports).toEqual([]);
  });
});
