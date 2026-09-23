import { describe, expect, it } from "bun:test";
import { sendDocumentResponseBody } from "../utils/pipelines/sending/response";
import type { DocumentDelivery } from "../data/deliveries/model";

// What the send returns is two things at once: what this request did, and where the
// document stands. They can differ, because the access point can report the
// transmission failed before the send has answered, and the email fallback the
// sender asked for then goes out inside the same call. `sentOverPeppol`,
// `sentOverEmail` and `emailRecipients` describe the request; `deliveries` and
// `deliveryStatus` are read back from the document afterwards and are the truth.

const statusChangedAt = new Date("2026-09-09T12:00:00Z");

function delivery(overrides: Partial<DocumentDelivery> & { id: string }): DocumentDelivery {
  return {
    transmittedDocumentId: "doc_1",
    teamId: "team_1",
    companyId: "cmp_1",
    channel: "peppol",
    address: "0208:987654321",
    status: "pending",
    statusChangedAt,
    failureCategory: null,
    failureMessage: null,
    failureProviderCode: null,
    provider: null,
    useTestNetwork: false,
    providerTransactionId: null,
    providerEventId: null,
    providerEventType: null,
    providerPayload: null,
    lastCheckedAt: null,
    createdAt: statusChangedAt,
    updatedAt: statusChangedAt,
    ...overrides,
  } as DocumentDelivery;
}

const as4Response = {
  ok: true,
  peppolMessageId: "msg-1",
  peppolConversationId: "conv-1",
  receivedPeppolSignalMessage: null,
  sbdhInstanceIdentifier: "env-1",
  apTransactionId: "tx-1",
};

describe("the body of a successful send", () => {
  it("describes the request in the legacy fields and the document in the deliveries", () => {
    // The access point reported the transmission failed while this call was still
    // recording it, so the fallback the sender asked for has already gone out.
    const body = sendDocumentResponseBody({
      teamId: "team_1",
      companyId: "cmp_1",
      documentId: "doc_1",
      as4Response,
      sentPeppol: true,
      emailRecipients: [],
      deliveries: [
        delivery({
          id: "dlv_1",
          status: "failed",
          failureCategory: "validation",
          failureMessage: "Schematron failed",
          failureProviderCode: "TXE-1005",
        }),
        delivery({ id: "dlv_2", channel: "email", address: "a@example.com", status: "pending" }),
      ],
      peppolFailure: "",
      emailFailure: "",
    });

    // The request handed the document to the access point and mailed nothing itself.
    expect(body.sentOverPeppol).toBe(true);
    expect(body.sentOverEmail).toBe(false);
    expect(body.emailRecipients).toEqual([]);
    // Where the document stands, fallback included.
    expect(body.deliveries.map((entry) => [entry.channel, entry.address, entry.status])).toEqual([
      ["peppol", "0208:987654321", "failed"],
      ["email", "a@example.com", "pending"],
    ]);
    expect(body.deliveryStatus).toBe("pending");
    expect(body.deliveries[0]!.failure).toEqual({
      category: "validation",
      message: "Schematron failed",
      providerCode: "TXE-1005",
    });
  });

  it("names the addresses this request mailed, and carries the transmission's references", () => {
    const body = sendDocumentResponseBody({
      teamId: "team_1",
      companyId: "cmp_1",
      documentId: "doc_1",
      as4Response,
      sentPeppol: true,
      emailRecipients: ["a@example.com"],
      deliveries: [delivery({ id: "dlv_1" })],
      peppolFailure: "",
      emailFailure: "",
    });

    expect(body.sentOverEmail).toBe(true);
    expect(body.emailRecipients).toEqual(["a@example.com"]);
    expect(body.peppolMessageId).toBe("msg-1");
    expect(body.envelopeId).toBe("env-1");
    expect(body.deliveries[0]!.references).toEqual({
      peppolMessageId: "msg-1",
      peppolConversationId: "conv-1",
      envelopeId: "env-1",
    });
  });

  it("adds the failure contexts only when there is something to say", () => {
    const input = {
      teamId: "team_1",
      companyId: "cmp_1",
      documentId: "doc_1",
      as4Response: null,
      sentPeppol: false,
      emailRecipients: [],
      deliveries: [],
      peppolFailure: "",
      emailFailure: "",
    };

    expect(sendDocumentResponseBody(input)).not.toHaveProperty("additionalPeppolFailureContext");
    expect(sendDocumentResponseBody(input).deliveryStatus).toBeNull();
    expect(
      sendDocumentResponseBody({ ...input, peppolFailure: "No receiver", emailFailure: "No mailbox" })
    ).toMatchObject({
      additionalPeppolFailureContext: "No receiver",
      additionalEmailFailureContext: "No mailbox",
    });
  });
});
