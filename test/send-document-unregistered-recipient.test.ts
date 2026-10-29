/**
 * Sending to a participant the Peppol network does not know.
 *
 * The transmission is skipped when the network itself answers that the participant does
 * not exist: the Peppol delivery fails as recipient_not_found, and the email fallback,
 * when configured, runs with the XML attached. A recipient whose capabilities were looked
 * up is registered; for any other, whether the lookup failed or a send that named its
 * format or is raw XML did not look it up, the SML is asked. Any other answer leaves the
 * transmission to be attempted.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

// Nothing under test touches the database, but some of the modules connect at import
// time. Everything that would is stubbed below.
mock.module("@recommand/db", () => ({ db: {} }));

let sendAs4: ReturnType<typeof mock>;

const { sendingPipeline } = await import("../utils/pipelines/sending");
const { sendDocumentSchema } = await import("../utils/parsing/send-document");
const { prepareJsonDocument } = await import("../utils/pipelines/sending/prepare-json-document");
const { invoiceDocument } = await import("./e2e/documents");
const companyIdentifiers = await import("../data/company-identifiers");
const email = await import("../data/email/send-email");
const metrics = await import("../utils/metrics");
const recipient = await import("../data/recipient");
const recipientCapabilities = await import("../data/recipient-capabilities");
const simulator = await import("../data/playground/simulate-ap");
const validation = await import("../utils/pipelines/sending/validate-document");
const recording = await import("../data/record-outgoing-document");
const accessPoints = await import("../data/access-point-providers");

const RECIPIENT = "0208:0598726857";
const SENDER = { scheme: "0208", identifier: "1234567894" };
const EMAIL_TO = "accounting@buyer.example";
const DOC_TYPE_ID =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const PROCESS_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const NOT_REGISTERED = `Recipient ${RECIPIENT} is not registered on the Peppol network.`;

const company = {
  id: "c_1",
  name: "Recommand E2E Seller",
  address: "Teststraat 1",
  postalCode: "1000",
  city: "Brussels",
  country: "BE",
  vatNumber: "BE1234567894",
  enterpriseNumber: "1234567894",
  enterpriseNumberScheme: "0208",
  email: "seller@example.com",
  phone: "+32 2 123 45 67",
  accessPointProvider: "recommand-ap1",
} as any;

function context(input: unknown, team: { isPlayground?: boolean; useTestNetwork?: boolean } = {}) {
  return {
    req: { valid: () => sendDocumentSchema.parse(input) },
    var: { company, team: { id: "team_1", isPlayground: false, useTestNetwork: false, ...team } },
    set: () => {},
    json: (body: any, status = 200) => ({ body, status }),
  } as any;
}

const send = (input: unknown, team?: { isPlayground?: boolean; useTestNetwork?: boolean }) =>
  sendingPipeline(context(input, team)) as unknown as Promise<{ body: any; status: number }>;

const jsonInvoice = (extra: Record<string, unknown> = {}) => ({
  recipient: RECIPIENT,
  documentType: "invoice",
  document: invoiceDocument(),
  ...extra,
});

let spies: { mockRestore(): void }[] = [];
let sentEmails: { to: string; xmlDocument: string | null }[];
let recorded: any[];

function stub<T extends object, K extends keyof T>(module: T, name: K) {
  const spy = spyOn(module, name as any);
  spies.push(spy);
  return spy;
}

beforeEach(() => {
  sentEmails = [];
  recorded = [];
  sendAs4 = mock(async () => ({
    ok: false,
    peppolMessageId: null,
    peppolConversationId: null,
    receivedPeppolSignalMessage: null,
    sbdhInstanceIdentifier: null,
    sendingException: { message: "Unable to reach the receiving access point", category: "transport" },
  }));
  stub(companyIdentifiers, "getSendingCompanyIdentifier").mockResolvedValue(SENDER as any);
  stub(validation, "validateDocument").mockResolvedValue({ result: "valid", errors: [] } as any);
  stub(email, "sendDocumentEmail").mockImplementation(async (options: any) => {
    sentEmails.push({ to: options.to, xmlDocument: options.xmlDocument });
    return { messageId: `msg-${sentEmails.length}` };
  });
  stub(accessPoints, "getAccessPointProvider").mockReturnValue({ sendAs4: (options: unknown) => sendAs4(options) } as any);
  stub(recording, "recordOutgoingDocument").mockImplementation(async (options: any) => {
    recorded.push(options);
    return { id: options.id, deliveries: [] } as any;
  });
  stub(metrics, "recordSendDocumentDelivery").mockImplementation(() => {});
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
});

describe("a JSON send that leaves the format open", () => {
  // The recipient lookup found nothing, which is where the SML is asked.
  const lookupFailed = () => stub(recipientCapabilities, "getRecipientCapabilities").mockResolvedValue(null);

  it("skips the transmission to an unregistered participant and falls back to email with the XML", async () => {
    lookupFailed();
    const smlCheck = stub(recipient, "isParticipantUnregistered").mockResolvedValue(true);

    const response = await send(jsonInvoice({ email: { to: [EMAIL_TO] } }));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      sentOverPeppol: false,
      sentOverEmail: true,
      emailRecipients: [EMAIL_TO],
      additionalPeppolFailureContext: NOT_REGISTERED,
    });
    expect(smlCheck).toHaveBeenCalledWith({ recipientAddress: RECIPIENT, useTestNetwork: false });
    expect(sendAs4).not.toHaveBeenCalled();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].xmlDocument).toContain(`<cbc:EndpointID schemeID="0208">0598726857</cbc:EndpointID>`);
    expect(recorded[0].delivery.peppolFailure).toEqual({
      category: "recipient_not_found",
      message: NOT_REGISTERED,
      providerCode: null,
    });
    expect(recorded[0].document.xml).toBe(sentEmails[0].xmlDocument);
  });

  it("answers 422 with the reason when no email is configured", async () => {
    lookupFailed();
    stub(recipient, "isParticipantUnregistered").mockResolvedValue(true);

    const response = await send(jsonInvoice());

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      success: false,
      errors: { root: [`Failed to send document over Peppol network. ${NOT_REGISTERED}`] },
      deliveryFailure: { channel: "peppol", category: "recipient_not_found" },
    });
    expect(sendAs4).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });

  it("names the test network on a test network team", async () => {
    lookupFailed();
    const smlCheck = stub(recipient, "isParticipantUnregistered").mockResolvedValue(true);

    const response = await send(jsonInvoice(), { isPlayground: true, useTestNetwork: true });

    expect(smlCheck).toHaveBeenCalledWith({ recipientAddress: RECIPIENT, useTestNetwork: true });
    expect(response.body.errors.root).toEqual([
      `Failed to send document over Peppol network. Recipient ${RECIPIENT} is not registered on the Peppol test network.`,
    ]);
  });

  it("still attempts the transmission when the SML does not say not registered", async () => {
    lookupFailed();
    stub(recipient, "isParticipantUnregistered").mockResolvedValue(false);

    const response = await send(jsonInvoice({ email: { to: [EMAIL_TO] } }));

    expect(sendAs4).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(recorded[0].delivery.peppolFailure.category).toBe("transport");
  });

  it("does not ask the SML about a recipient whose capabilities were found", async () => {
    stub(recipientCapabilities, "getRecipientCapabilities").mockResolvedValue({
      supportsDocType: (docTypeId: string) => docTypeId === DOC_TYPE_ID,
      getProcessIds: async () => [PROCESS_ID],
    });
    const smlCheck = stub(recipient, "isParticipantUnregistered").mockResolvedValue(true);

    await send(jsonInvoice({ email: { to: [EMAIL_TO] } }));

    expect(smlCheck).not.toHaveBeenCalled();
    expect(sendAs4).toHaveBeenCalledTimes(1);
  });

  it("leaves a simulated playground to its simulator, whatever the SML says", async () => {
    lookupFailed();
    const smlCheck = stub(recipient, "isParticipantUnregistered").mockResolvedValue(true);
    const simulate = stub(simulator, "simulateSendAs4").mockResolvedValue(undefined);

    const response = await send(jsonInvoice(), { isPlayground: true });

    expect(smlCheck).not.toHaveBeenCalled();
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(response.body.sentOverPeppol).toBe(true);
  });
});

describe("a send that names its format", () => {
  const explicit = (extra: Record<string, unknown> = {}) =>
    jsonInvoice({ doctypeId: DOC_TYPE_ID, processId: PROCESS_ID, ...extra });

  async function rawXml(): Promise<Record<string, unknown>> {
    const prepared = await prepareJsonDocument({
      input: sendDocumentSchema.parse(jsonInvoice()) as any,
      company,
      senderAddress: `${SENDER.scheme}:${SENDER.identifier}`,
      recipientAddress: RECIPIENT,
      documentId: "doc_raw",
    });
    return { recipient: RECIPIENT, documentType: "xml", document: prepared.xml };
  }

  for (const [name, input] of [
    ["with doctypeId and processId", async () => explicit({ email: { to: [EMAIL_TO] } })],
    ["as raw XML", async () => ({ ...(await rawXml()), email: { to: [EMAIL_TO] } })],
  ] as const) {
    it(`${name}: asks the SML alone, and skips the transmission when it says not registered`, async () => {
      const lookup = stub(recipientCapabilities, "getRecipientCapabilities");
      const smlCheck = stub(recipient, "isParticipantUnregistered").mockResolvedValue(true);

      const response = await send(await input());

      expect(lookup).not.toHaveBeenCalled();
      expect(smlCheck).toHaveBeenCalledWith({ recipientAddress: RECIPIENT, useTestNetwork: false });
      expect(sendAs4).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.body.emailRecipients).toEqual([EMAIL_TO]);
      expect(sentEmails[0].xmlDocument).toContain("<Invoice");
      expect(recorded[0].delivery.peppolFailure.category).toBe("recipient_not_found");
    });

    it(`${name}: attempts the transmission when the SML does not say not registered`, async () => {
      stub(recipient, "isParticipantUnregistered").mockResolvedValue(false);

      await send(await input());

      expect(sendAs4).toHaveBeenCalledTimes(1);
    });
  }

  it("leaves a simulated playground to its simulator", async () => {
    const smlCheck = stub(recipient, "isParticipantUnregistered").mockResolvedValue(true);
    const simulate = stub(simulator, "simulateSendAs4").mockResolvedValue(undefined);

    const response = await send(explicit(), { isPlayground: true });

    expect(smlCheck).not.toHaveBeenCalled();
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(response.body.sentOverPeppol).toBe(true);
  });
});

describe("an email-only send in a French regulated format", () => {
  it("is refused with the email-only reason before the document is written", async () => {
    const response = await send({
      recipient: null,
      documentType: "invoice",
      // A plain invoice, without the fields the French formats require.
      document: invoiceDocument(),
      doctypeId:
        "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::2.1",
      email: { to: [EMAIL_TO] },
    });

    expect(response.status).toBe(400);
    expect(response.body.errors.root).toEqual([
      "French regulated documents cannot be delivered by email only. Send them to a Peppol recipient.",
    ]);
    expect(sentEmails).toHaveLength(0);
  });
});
