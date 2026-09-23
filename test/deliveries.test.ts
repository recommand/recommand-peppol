import { describe, expect, it } from "bun:test";
import {
  attachDeliveries,
  categorizeArratechServiceError,
  categorizePostmarkBounce,
  deliveryIdFromEmailMetadata,
  deliveryStatusMoves,
  documentEmailMetadata,
  interpretArratechTransactionStatus,
  interpretPostmarkBounce,
  interpretPostmarkWebhook,
  postmarkBounceFailure,
  postmarkBounceId,
  postmarkMessageOutcomes,
  summarizeDeliveryStatus,
  toDeliverySummary,
} from "../data/deliveries/model";
import { deliveryResponse, transmittedDocumentResponse } from "../api/documents/shared";

describe("delivery failure categories", () => {
  it("maps the access point's categories onto ours and leaves the code alongside", () => {
    expect(categorizeArratechServiceError("RECIPIENT_NOT_FOUND")).toBe("recipient_not_found");
    expect(categorizeArratechServiceError("NETWORK_LOOKUP_ERROR")).toBe("recipient_not_found");
    expect(categorizeArratechServiceError("DOCUMENT_TYPE_NOT_SUPPORTED")).toBe("document_not_supported");
    expect(categorizeArratechServiceError("VALIDATION_ERROR")).toBe("validation");
    expect(categorizeArratechServiceError("POLICY_VIOLATION")).toBe("validation");
    expect(categorizeArratechServiceError("TRANSPORT_ERROR")).toBe("transport");
    expect(categorizeArratechServiceError("CERTIFICATE_ERROR")).toBe("transport");
    expect(categorizeArratechServiceError("RECIPIENT_REJECTED")).toBe("recipient_rejected");
    expect(categorizeArratechServiceError("DUPLICATE")).toBe("duplicate");
  });

  it("files internal, security and unknown categories under other", () => {
    expect(categorizeArratechServiceError("INTERNAL_ERROR")).toBe("other");
    expect(categorizeArratechServiceError("SECURITY_ALERT")).toBe("other");
    expect(categorizeArratechServiceError("SOMETHING_NEW")).toBe("other");
    expect(categorizeArratechServiceError(null)).toBe("other");
    expect(categorizeArratechServiceError(undefined)).toBe("other");
  });
});

describe("document delivery status", () => {
  it("is delivered as soon as one channel confirmed arrival", () => {
    expect(summarizeDeliveryStatus(["delivered"])).toBe("delivered");
    expect(summarizeDeliveryStatus(["failed", "delivered"])).toBe("delivered");
    expect(summarizeDeliveryStatus(["pending", "delivered", "failed"])).toBe("delivered");
  });

  it("is failed only when every delivery failed", () => {
    expect(summarizeDeliveryStatus(["failed"])).toBe("failed");
    expect(summarizeDeliveryStatus(["failed", "failed"])).toBe("failed");
    expect(summarizeDeliveryStatus(["failed", "pending"])).toBe("pending");
  });

  it("is pending while anything is still open, and null without deliveries", () => {
    expect(summarizeDeliveryStatus(["pending"])).toBe("pending");
    expect(summarizeDeliveryStatus(["pending", "pending"])).toBe("pending");
    expect(summarizeDeliveryStatus([])).toBeNull();
  });
});

describe("applying a provider's report", () => {
  it("moves a pending delivery to what was reported", () => {
    expect(deliveryStatusMoves("pending", "delivered")).toBe(true);
    expect(deliveryStatusMoves("pending", "failed")).toBe(true);
  });

  it("never overwrites a final status with a stale or repeated report", () => {
    expect(deliveryStatusMoves("delivered", "failed")).toBe(false);
    expect(deliveryStatusMoves("failed", "delivered")).toBe(false);
    expect(deliveryStatusMoves("delivered", "delivered")).toBe(false);
    expect(deliveryStatusMoves("failed", "failed")).toBe(false);
    expect(deliveryStatusMoves("pending", "pending")).toBe(false);
  });
});

describe("reconciling a transaction with the access point", () => {
  it("confirms a completed transaction and fails a failed or rejected one", () => {
    expect(interpretArratechTransactionStatus({ transactionStatus: "COMPLETED" })).toEqual({
      status: "delivered",
      failure: null,
    });
    expect(
      interpretArratechTransactionStatus({
        transactionStatus: "FAILED",
        serviceError: { code: "TXE-1005", message: "Schematron failed", category: "VALIDATION_ERROR" },
      })
    ).toEqual({
      status: "failed",
      failure: { category: "validation", message: "Schematron failed", providerCode: "TXE-1005" },
    });
    expect(interpretArratechTransactionStatus({ transactionStatus: "rejected" })).toEqual({
      status: "failed",
      failure: { category: "other", message: null, providerCode: null },
    });
  });

  it("leaves a delivery pending on a status whose meaning is not settled", () => {
    expect(interpretArratechTransactionStatus({ transactionStatus: "COMPLETED_NO_DELIVERY" })).toBeNull();
    expect(interpretArratechTransactionStatus({ transactionStatus: "PENDING" })).toBeNull();
    expect(interpretArratechTransactionStatus({ transactionStatus: null })).toBeNull();
    expect(interpretArratechTransactionStatus({})).toBeNull();
  });
});

describe("deliveries on documents", () => {
  const changedAt = new Date("2026-09-09T10:00:00Z");
  const documents = [
    { id: "doc_1", direction: "outgoing", peppolMessageId: "msg-1", peppolConversationId: "conv-1", envelopeId: "env-1" },
    { id: "doc_2", direction: "outgoing", peppolMessageId: null, peppolConversationId: null, envelopeId: null },
    { id: "doc_3", direction: "incoming", peppolMessageId: "msg-3", peppolConversationId: null, envelopeId: null },
  ] as const;
  const rows = [
    { id: "dlv_1", transmittedDocumentId: "doc_1", channel: "peppol", address: "0208:1", status: "delivered", statusChangedAt: changedAt, failureCategory: null, failureMessage: null, failureProviderCode: null, providerTransactionId: "tx-1" },
    { id: "dlv_2", transmittedDocumentId: "doc_1", channel: "email", address: "a@example.com", status: "pending", statusChangedAt: changedAt, failureCategory: null, failureMessage: null, failureProviderCode: null, providerTransactionId: "883953f4-6105-42a2-a16a-77a8eac79483" },
    { id: "dlv_3", transmittedDocumentId: "doc_2", channel: "peppol", address: "0208:2", status: "failed", statusChangedAt: changedAt, failureCategory: "validation", failureMessage: "Schematron failed", failureProviderCode: "TXE-1005", providerTransactionId: null },
  ] as const;

  it("groups deliveries under their document with the document's transport references", () => {
    const [first, second, third] = attachDeliveries([...documents], [...rows]);

    expect(first!.deliveryStatus).toBe("delivered");
    expect(first!.deliveries).toEqual([
      {
        id: "dlv_1",
        channel: "peppol",
        address: "0208:1",
        status: "delivered",
        statusChangedAt: "2026-09-09T10:00:00.000Z",
        failure: null,
        references: { peppolMessageId: "msg-1", peppolConversationId: "conv-1", envelopeId: "env-1" },
      },
      {
        id: "dlv_2",
        channel: "email",
        address: "a@example.com",
        status: "pending",
        statusChangedAt: "2026-09-09T10:00:00.000Z",
        failure: null,
        // The email delivery's reference is its own message, not the document's transmission.
        references: { messageId: "883953f4-6105-42a2-a16a-77a8eac79483" },
      },
    ]);

    expect(second!.deliveryStatus).toBe("failed");
    expect(second!.deliveries[0]!.failure).toEqual({
      category: "validation",
      message: "Schematron failed",
      providerCode: "TXE-1005",
    });

    expect(third!.deliveries).toEqual([]);
    expect(third!.deliveryStatus).toBeNull();
  });

  it("only reports a failure on a failed delivery, defaulting an unclassified one to other", () => {
    const summary = toDeliverySummary(
      { id: "dlv_4", channel: "peppol", address: "0208:4", status: "failed", statusChangedAt: changedAt, failureCategory: null, failureMessage: null, failureProviderCode: null, providerTransactionId: null },
      {}
    );
    expect(summary.failure).toEqual({ category: "other", message: null, providerCode: null });
    expect(summary.references).toEqual({ peppolMessageId: null, peppolConversationId: null, envelopeId: null });
  });

  it("gives an email delivery recorded before message tracking a null message id", () => {
    const summary = toDeliverySummary(
      { id: "dlv_5", channel: "email", address: "a@example.com", status: "pending", statusChangedAt: changedAt, failureCategory: null, failureMessage: null, failureProviderCode: null, providerTransactionId: null },
      { peppolMessageId: "msg-1", envelopeId: "env-1" }
    );
    expect(summary.references).toEqual({ messageId: null });
    expect(deliveryResponse.parse(summary).references).toEqual({ messageId: null });
  });

  it("exposes deliveries and their summary on the document API, and nothing older", () => {
    const shape = transmittedDocumentResponse.shape;
    expect(shape.deliveries).toBeDefined();
    expect(shape.deliveryStatus).toBeDefined();
    expect("deliveryFailure" in shape).toBe(false);

    const parsed = deliveryResponse.parse({
      id: "dlv_1",
      channel: "peppol",
      address: "0208:1",
      status: "failed",
      statusChangedAt: "2026-09-09T10:00:00.000Z",
      failure: { category: "transport", message: null, providerCode: null },
      references: { peppolMessageId: null, peppolConversationId: null, envelopeId: "env-1" },
    });
    expect(parsed.status).toBe("failed");
    expect(() => deliveryResponse.parse({ ...parsed, status: "not_sent" })).toThrow();
  });
});

describe("Postmark reports", () => {
  it("maps bounce types onto our categories and keeps the type as the provider code", () => {
    expect(categorizePostmarkBounce("HardBounce")).toBe("recipient_not_found");
    expect(categorizePostmarkBounce("BadEmailAddress")).toBe("recipient_not_found");
    expect(categorizePostmarkBounce("SoftBounce")).toBe("transport");
    expect(categorizePostmarkBounce("Transient")).toBe("transport");
    expect(categorizePostmarkBounce("DnsError")).toBe("transport");
    expect(categorizePostmarkBounce("DMARCPolicy")).toBe("transport");
    expect(categorizePostmarkBounce("SpamNotification")).toBe("recipient_rejected");
    expect(categorizePostmarkBounce("SpamComplaint")).toBe("recipient_rejected");
    expect(categorizePostmarkBounce("Blocked")).toBe("recipient_rejected");
    expect(categorizePostmarkBounce("ManuallyDeactivated")).toBe("recipient_rejected");
    expect(categorizePostmarkBounce("Unknown")).toBe("other");
    expect(categorizePostmarkBounce("TemplateRenderingFailed")).toBe("other");
    expect(categorizePostmarkBounce(undefined)).toBe("other");

    expect(
      postmarkBounceFailure({
        Type: "HardBounce",
        TypeCode: 1,
        Description: "The server was unable to deliver your message.",
        Details: "smtp;550 5.1.1 The email account does not exist",
      })
    ).toEqual({
      category: "recipient_not_found",
      message: "The server was unable to deliver your message. smtp;550 5.1.1 The email account does not exist",
      providerCode: "HardBounce",
    });
    expect(postmarkBounceFailure({ TypeCode: 4096 })).toEqual({
      category: "other",
      message: null,
      providerCode: "4096",
    });
  });

  it("confirms a delivery record and fails a bounce or spam complaint", () => {
    expect(interpretPostmarkWebhook({ RecordType: "Delivery" })).toEqual({
      kind: "report",
      status: "delivered",
      failure: null,
    });
    expect(
      interpretPostmarkWebhook({ RecordType: "Bounce", Type: "SoftBounce", Description: "Mailbox full" })
    ).toEqual({
      kind: "report",
      status: "failed",
      failure: { category: "transport", message: "Mailbox full", providerCode: "SoftBounce" },
    });
    expect(
      interpretPostmarkWebhook({ RecordType: "SpamComplaint", Type: "SpamComplaint", TypeCode: 100001 })
    ).toMatchObject({
      kind: "report",
      status: "failed",
      failure: { category: "recipient_rejected", providerCode: "SpamComplaint" },
    });
  });

  it("leaves a delivery alone for a bounce that is not a delivery outcome", () => {
    expect(interpretPostmarkWebhook({ RecordType: "Bounce", Type: "AutoResponder" })).toEqual({
      kind: "informational",
      reason: "bounce type AutoResponder",
    });
    expect(interpretPostmarkWebhook({ RecordType: "Bounce", Type: "ChallengeVerification" })).toMatchObject({
      kind: "informational",
    });
    expect(interpretPostmarkWebhook({ RecordType: "Open" })).toBeNull();
    expect(interpretPostmarkWebhook({ RecordType: "SubscriptionChange" })).toBeNull();
  });

  it("reads a message's deciding events latest first, and finds none in a history that decides nothing", () => {
    expect(postmarkMessageOutcomes([])).toEqual([]);
    expect(
      postmarkMessageOutcomes([
        { Type: "Transient", ReceivedAt: "2026-09-09T10:00:00Z", Details: { DeliveryMessage: "greylisted" } },
        { Type: "Opened", ReceivedAt: "2026-09-09T10:05:00Z", Details: {} },
      ])
    ).toEqual([]);

    const delivered = { Type: "Delivered", ReceivedAt: "2026-09-09T10:10:00Z", Details: { DeliveryMessage: "250 ok" } };
    expect(
      postmarkMessageOutcomes([
        { Type: "Transient", ReceivedAt: "2026-09-09T10:00:00Z", Details: {} },
        delivered,
      ])
    ).toEqual([{ status: "delivered", event: delivered }]);

    const bounced = { Type: "Bounced", ReceivedAt: "2026-09-09T10:20:00Z", Details: { Summary: "Mailbox not found", BounceID: 42 } };
    const bounce = { status: "failed" as const, event: bounced, bounceId: 42, summary: "Mailbox not found" };
    // The later bounce decides first, and the delivery that came before it is still
    // there for a caller that finds the bounce says nothing about delivery.
    expect(postmarkMessageOutcomes([delivered, bounced])).toEqual([
      bounce,
      { status: "delivered", event: delivered },
    ]);
    // The order the events are listed in does not matter, their times do.
    expect(postmarkMessageOutcomes([bounced, delivered])).toEqual(
      postmarkMessageOutcomes([delivered, bounced])
    );
    const laterDelivery = { ...delivered, ReceivedAt: "2026-09-09T10:30:00Z" };
    expect(postmarkMessageOutcomes([bounced, laterDelivery])[0]).toEqual({
      status: "delivered",
      event: laterDelivery,
    });
  });

  it("takes the bounce id the messages API documents, which is a numeric string", () => {
    // Postmark's own example gives the id as a string; the bounces API takes a number.
    const bounced = (bounceId: unknown) => ({
      Type: "Bounced",
      ReceivedAt: "2026-09-09T10:20:00Z",
      Details: { Summary: "Mailbox not found", BounceID: bounceId },
    });
    expect(postmarkBounceId("374814878")).toBe(374814878);
    expect(postmarkBounceId(374814878)).toBe(374814878);
    expect(postmarkMessageOutcomes([bounced("374814878")])[0]).toMatchObject({ bounceId: 374814878 });
    // Anything that is not a whole positive number is no bounce to look up.
    expect(postmarkBounceId("not-a-number")).toBeNull();
    expect(postmarkBounceId("")).toBeNull();
    expect(postmarkBounceId(0)).toBeNull();
    expect(postmarkBounceId(1.5)).toBeNull();
    expect(postmarkBounceId(null)).toBeNull();
    expect(postmarkMessageOutcomes([bounced(undefined)])[0]).toMatchObject({ bounceId: null });
  });

  it("reads a bounce the same way whichever path saw it", () => {
    const hard = { Type: "HardBounce", Description: "The server could not find the address" };
    expect(interpretPostmarkBounce(hard)).toEqual({
      kind: "report",
      status: "failed",
      failure: {
        category: "recipient_not_found",
        message: "The server could not find the address",
        providerCode: "HardBounce",
      },
    });
    // The webhook decides through the same function, so the two cannot diverge.
    expect(interpretPostmarkWebhook({ RecordType: "Bounce", ...hard })).toEqual(
      interpretPostmarkBounce(hard)
    );
    const informational = { Type: "AutoResponder", Description: "Out of office" };
    expect(interpretPostmarkBounce(informational)).toEqual({
      kind: "informational",
      reason: "bounce type AutoResponder",
    });
    expect(interpretPostmarkWebhook({ RecordType: "Bounce", ...informational })).toEqual(
      interpretPostmarkBounce(informational)
    );
  });

  it("finds the delivery a message was sent for in the metadata it was sent with", () => {
    const metadata = documentEmailMetadata({ deliveryId: "dlv_1", documentId: "doc_1" });
    expect(metadata).toEqual({ deliveryId: "dlv_1", documentId: "doc_1" });
    expect(deliveryIdFromEmailMetadata(metadata)).toBe("dlv_1");
    // Mail that is not a document delivery carries no delivery, whatever else it carries.
    expect(deliveryIdFromEmailMetadata({ example: "value" })).toBeNull();
    expect(deliveryIdFromEmailMetadata({ deliveryId: "" })).toBeNull();
    expect(deliveryIdFromEmailMetadata(undefined)).toBeNull();
  });
});
