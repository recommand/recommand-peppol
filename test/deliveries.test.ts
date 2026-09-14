import { describe, expect, it } from "bun:test";
import {
  attachDeliveries,
  categorizeArratechServiceError,
  deliveryStatusMoves,
  interpretArratechTransactionStatus,
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
    { id: "dlv_1", transmittedDocumentId: "doc_1", channel: "peppol", address: "0208:1", status: "delivered", statusChangedAt: changedAt, failureCategory: null, failureMessage: null, failureProviderCode: null },
    { id: "dlv_2", transmittedDocumentId: "doc_1", channel: "email", address: "a@example.com", status: "pending", statusChangedAt: changedAt, failureCategory: null, failureMessage: null, failureProviderCode: null },
    { id: "dlv_3", transmittedDocumentId: "doc_2", channel: "peppol", address: "0208:2", status: "failed", statusChangedAt: changedAt, failureCategory: "validation", failureMessage: "Schematron failed", failureProviderCode: "TXE-1005" },
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
        references: {},
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
      { id: "dlv_4", channel: "peppol", address: "0208:4", status: "failed", statusChangedAt: changedAt, failureCategory: null, failureMessage: null, failureProviderCode: null },
      {}
    );
    expect(summary.failure).toEqual({ category: "other", message: null, providerCode: null });
    expect(summary.references).toEqual({ peppolMessageId: null, peppolConversationId: null, envelopeId: null });
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
