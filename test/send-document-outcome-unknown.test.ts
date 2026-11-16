/**
 * A failed send says whether the document may have gone out all the same.
 *
 * The 422 carries `outcomeUnknown`: false when every channel refused the document, true
 * when one may have delivered it, so a client knows whether sending it again could
 * deliver it twice.
 */

import { describe, expect, it } from "bun:test";
import { send, useSendingPipeline } from "./utils/sending-pipeline";

const { invoiceDocument } = await import("./e2e/documents");
const audit = await import("@core/lib/audit");
const companyIdentifiers = await import("../data/company-identifiers");
const email = await import("../data/email/send-email");
const recipient = await import("../data/recipient");
const recipientCapabilities = await import("../data/recipient-capabilities");
const recording = await import("../data/record-outgoing-document");
const systemNotifications = await import("../utils/system-notifications/telegram");

const RECIPIENT = "0208:0598726857";

const failedTransmission = (extra: Record<string, unknown> = {}) => ({
  ok: false,
  peppolMessageId: null,
  peppolConversationId: null,
  receivedPeppolSignalMessage: null,
  sbdhInstanceIdentifier: null,
  sendingException: { message: "The receiving access point refused the document", category: "validation" },
  ...extra,
});

const { sendAs4, stub } = useSendingPipeline({ transmission: () => failedTransmission() });

/** Makes the next send fail unexpectedly, without auditing or alerting anyone. */
const failUnexpectedly = (module: any, name: string) => {
  stub(audit, "audit").mockResolvedValue(undefined as any);
  stub(systemNotifications, "sendSystemAlert").mockImplementation(() => {});
  stub(module, name).mockRejectedValue(new Error("Connection terminated unexpectedly"));
};

const peppolInvoice = () => {
  stub(recipientCapabilities, "getRecipientCapabilities").mockResolvedValue(null);
  stub(recipient, "isParticipantUnregistered").mockResolvedValue(false);

  return { recipient: RECIPIENT, documentType: "invoice", document: invoiceDocument() };
};

describe("a send that fails", () => {
  it("says the outcome is known when the access point refused the document", async () => {
    const response = await send(peppolInvoice());

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      deliveryFailure: { channel: "peppol", category: "validation" },
      outcomeUnknown: false,
    });
  });

  it("says the outcome is unknown when the access point may have sent the document", async () => {
    sendAs4.mockResolvedValue(failedTransmission({ outcomeUnknown: true, sendingException: undefined }));

    const response = await send(peppolInvoice());

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      deliveryFailure: { channel: "peppol", category: "transport" },
      outcomeUnknown: true,
    });
  });

  it("says the outcome is unknown when the mail service didn't confirm the email", async () => {
    stub(email, "sendDocumentEmail").mockRejectedValue(new Error("Mail service unavailable"));

    const response = await send({
      recipient: null,
      documentType: "invoice",
      document: invoiceDocument(),
      email: { to: ["accounting@buyer.example"] },
    });

    expect(response.status).toBe(422);
    expect(response.body.outcomeUnknown).toBe(true);
    expect("deliveryFailure" in response.body).toBe(false);
  });

  it("says the outcome is unknown when the send fails unexpectedly after a channel was tried", async () => {
    sendAs4.mockResolvedValue({ ...failedTransmission(), ok: true, sendingException: undefined });
    failUnexpectedly(recording, "recordOutgoingDocument");

    const response = await send(peppolInvoice());

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ outcomeUnknown: true, success: false });
    expect("deliveryFailure" in response.body).toBe(false);
  });

  it("answers as before when the send fails unexpectedly before any channel was tried", async () => {
    failUnexpectedly(companyIdentifiers, "getSendingCompanyIdentifier");

    const response = await send(peppolInvoice());

    expect(response.status).toBe(400);
    expect("outcomeUnknown" in response.body).toBe(false);
    expect(sendAs4).not.toHaveBeenCalled();
  });
});
