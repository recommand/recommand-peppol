import { beforeEach, describe, expect, it, mock } from "bun:test";

// The email reconciliation poll asks the mail service about pending email
// deliveries and hands what it learns to the same report application the webhook
// uses, with the bounce looked up so the failure gets the webhook's category.

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
const due = [
  { id: "dlv_1", providerTransactionId: "msg-delivered" },
  { id: "dlv_2", providerTransactionId: "msg-bounced" },
  { id: "dlv_3", providerTransactionId: "msg-waiting" },
  { id: "dlv_4", providerTransactionId: "msg-forgotten" },
];
let failCheckNoteFor: string[] = [];
let notes = 0;

mock.module("@recommand/db", () => ({
  db: {
    select: () => chain(due),
    // The loop is serial, so the note being written is the one for the delivery
    // the poll has just dealt with.
    update: () => ({
      set: () => ({
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
const model = await import("../../data/deliveries/model");
mock.module("@peppol/data/deliveries", () => ({
  ...model,
  applyProviderDeliveryReport: async (report: unknown) => {
    applied.push(report);
    return "applied";
  },
}));

const { reconcilePendingEmailDeliveries } = await import("../../data/deliveries/reconcile-email");

const bounced = { Type: "Bounced", ReceivedAt: "2026-09-09T10:20:00Z", Details: { Summary: "Mailbox not found", BounceID: 42 } };
const delivered = { Type: "Delivered", ReceivedAt: "2026-09-09T10:10:00Z", Details: { DeliveryMessage: "250 ok" } };

const logger = { info: () => {}, warn: () => {}, error: () => {} } as never;

beforeEach(() => {
  applied.length = 0;
  checked.length = 0;
  notes = 0;
  failCheckNoteFor = [];
});

describe("the email reconciliation poll", () => {
  it("applies what the mail service answers through the same path as the webhook", async () => {
    const bounces: number[] = [];

    const progress = await reconcilePendingEmailDeliveries(logger, {
      async messageEvents(messageId) {
        switch (messageId) {
          case "msg-delivered":
            return [{ Type: "Transient", ReceivedAt: "2026-09-09T10:00:00Z", Details: {} }, delivered];
          case "msg-bounced":
            return [bounced];
          case "msg-waiting":
            return [{ Type: "Transient", ReceivedAt: "2026-09-09T10:00:00Z", Details: {} }];
          default:
            throw new Error("Message not found (701)");
        }
      },
      async bounce(bounceId) {
        bounces.push(bounceId);
        return { Type: "HardBounce", TypeCode: 1, Description: "Unknown user", Details: "smtp;550 5.1.1" };
      },
    });

    expect(progress).toEqual({ checked: 4, applied: 2 });
    expect(bounces).toEqual([42]);
    expect(applied).toEqual([
      {
        channel: "email",
        provider: "postmark",
        providerTransactionId: "msg-delivered",
        deliveryId: "dlv_1",
        useTestNetwork: false,
        status: "delivered",
        failure: null,
        eventId: null,
        eventType: null,
        payload: { event: delivered },
      },
      {
        channel: "email",
        provider: "postmark",
        providerTransactionId: "msg-bounced",
        deliveryId: "dlv_2",
        useTestNetwork: false,
        status: "failed",
        failure: { category: "recipient_not_found", message: "Unknown user smtp;550 5.1.1", providerCode: "HardBounce" },
        eventId: null,
        eventType: null,
        payload: expect.objectContaining({ event: bounced }),
      },
    ]);
    // Every delivery was asked about, including the one still on its way and the
    // one the mail service no longer knows; both stay pending.
    expect(checked).toHaveLength(4);
  });

  it("keeps the bounce's summary as the reason when the bounce cannot be looked up", async () => {
    await reconcilePendingEmailDeliveries(logger, {
      async messageEvents(messageId) {
        return messageId === "msg-bounced" ? [bounced] : [];
      },
      async bounce() {
        throw new Error("Bounce not found");
      },
    });

    expect(applied).toEqual([
      expect.objectContaining({
        deliveryId: "dlv_2",
        status: "failed",
        failure: { category: "other", message: "Mailbox not found", providerCode: null },
      }),
    ]);
  });

  it("looks the bounce up when the messages API gives its id as the numeric string it documents", async () => {
    const bounces: number[] = [];

    await reconcilePendingEmailDeliveries(logger, {
      async messageEvents(messageId) {
        return messageId === "msg-bounced"
          ? [{ ...bounced, Details: { Summary: "Mailbox not found", BounceID: "374814878" } }]
          : [];
      },
      async bounce(bounceId) {
        bounces.push(bounceId);
        return { Type: "HardBounce", Description: "Unknown user" };
      },
    });

    expect(bounces).toEqual([374814878]);
    expect(applied).toEqual([
      expect.objectContaining({
        deliveryId: "dlv_2",
        status: "failed",
        failure: {
          category: "recipient_not_found",
          message: "Unknown user",
          providerCode: "HardBounce",
        },
      }),
    ]);
  });

  it("does not fail a delivery on a bounce that says nothing about delivery", async () => {
    // An out-of-office reply is filed under bounces and is not a delivery outcome;
    // the webhook ignores it, and so must the poll.
    await reconcilePendingEmailDeliveries(logger, {
      async messageEvents(messageId) {
        return messageId === "msg-bounced" ? [bounced] : [];
      },
      async bounce() {
        return { Type: "AutoResponder", Description: "Out of office" };
      },
    });

    expect(applied).toEqual([]);
    // It was still asked about, so it comes round again rather than being forgotten.
    expect(checked).toContain("dlv_2");
  });

  it("lets an earlier delivery confirmation stand behind such a bounce", async () => {
    await reconcilePendingEmailDeliveries(logger, {
      async messageEvents(messageId) {
        return messageId === "msg-bounced" ? [delivered, bounced] : [];
      },
      async bounce() {
        return { Type: "AutoResponder", Description: "Out of office" };
      },
    });

    expect(applied).toEqual([
      expect.objectContaining({
        deliveryId: "dlv_2",
        status: "delivered",
        failure: null,
        payload: { event: delivered },
      }),
    ]);
  });

  it("carries on with the batch when a delivery's check cannot be noted", async () => {
    failCheckNoteFor = ["dlv_1"];
    const asked: string[] = [];

    const progress = await reconcilePendingEmailDeliveries(logger, {
      async messageEvents(messageId) {
        asked.push(messageId);
        return messageId === "msg-delivered" ? [delivered] : [];
      },
      async bounce() {
        return {};
      },
    });

    expect(asked).toEqual(["msg-delivered", "msg-bounced", "msg-waiting", "msg-forgotten"]);
    expect(progress).toEqual({ checked: 4, applied: 1 });
    // Only the deliveries whose note was written are marked checked.
    expect(checked).toEqual(["dlv_2", "dlv_3", "dlv_4"]);
  });
});
