import { describe, expect, it } from "bun:test";
import { sendDocumentEmails } from "../data/email/send-document-emails";

// Both the send itself and the later email fallback mail a document through this
// one function, so what it attaches to a message is what every report about the
// message comes back with.

describe("mailing a document to its recipients", () => {
  it("sends each message under a delivery of its own and keeps the mail service's id for it", async () => {
    const messages: { to: string; metadata: Record<string, string> }[] = [];
    let ids = 0;

    const outcome = await sendDocumentEmails({
      documentId: "doc_1",
      recipients: ["a@example.com", "b@example.com"],
      deliveryId: () => `dlv_${++ids}`,
      send: async (message) => {
        messages.push(message);
        return { messageId: `msg-${messages.length}` };
      },
    });

    expect(messages).toEqual([
      { to: "a@example.com", metadata: { deliveryId: "dlv_1", documentId: "doc_1" } },
      { to: "b@example.com", metadata: { deliveryId: "dlv_2", documentId: "doc_1" } },
    ]);
    expect(outcome).toEqual({
      sent: [
        { deliveryId: "dlv_1", address: "a@example.com", providerMessageId: "msg-1" },
        { deliveryId: "dlv_2", address: "b@example.com", providerMessageId: "msg-2" },
      ],
      failed: [],
    });
  });

  it("gives every delivery a fresh id when none is supplied", async () => {
    const outcome = await sendDocumentEmails({
      documentId: "doc_1",
      recipients: ["a@example.com", "a@example.com"],
      send: async () => ({ messageId: null }),
    });

    const ids = outcome.sent.map((message) => message.deliveryId);
    expect(ids.every((id) => id.startsWith("dlv_"))).toBe(true);
    expect(new Set(ids).size).toBe(2);
    expect(outcome.sent.map((message) => message.providerMessageId)).toEqual([null, null]);
  });

  it("reports an address the mail service refused, with its reason, and carries on", async () => {
    const outcome = await sendDocumentEmails({
      documentId: "doc_1",
      recipients: ["a@example.com", "b@example.com"],
      deliveryId: (() => {
        let ids = 0;
        return () => `dlv_${++ids}`;
      })(),
      send: async ({ to }) => {
        if (to === "a@example.com") {
          throw new Error("Invalid 'To' address");
        }
        return { messageId: "msg-2" };
      },
    });

    expect(outcome).toEqual({
      sent: [{ deliveryId: "dlv_2", address: "b@example.com", providerMessageId: "msg-2" }],
      failed: [{ deliveryId: "dlv_1", address: "a@example.com", message: "Invalid 'To' address" }],
    });
  });
});
