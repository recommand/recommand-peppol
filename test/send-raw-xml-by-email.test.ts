/**
 * Raw XML sent without a Peppol recipient.
 *
 * A caller that writes its own documents can email one to a buyer who is not on Peppol
 * as it is: the XML is validated, stored and attached exactly as given. Email is a
 * channel for billing documents only, so anything else is refused, and so is XML that
 * could not be read as one of the supported formats, whose type is then unknown.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

// Nothing under test touches the database, but some of the modules connect at import
// time. Everything that would is stubbed below.
mock.module("@recommand/db", () => ({ db: {} }));

const { sendingPipeline } = await import("../utils/pipelines/sending");
const { sendDocumentSchema } = await import("../utils/parsing/send-document");
const { prepareJsonDocument } = await import("../utils/pipelines/sending/prepare-json-document");
const { DOC_TYPE_ID, invoiceDocument, selfBillingInvoiceDocument } = await import("./e2e/documents");
const companyIdentifiers = await import("../data/company-identifiers");
const email = await import("../data/email/send-email");
const metrics = await import("../utils/metrics");
const validation = await import("../utils/pipelines/sending/validate-document");
const { SendingFailure } = await import("../utils/pipelines/sending/errors");
const recording = await import("../data/record-outgoing-document");
const accessPoints = await import("../data/access-point-providers");

const BUYER = "0208:0598726857";
const SENDER = { scheme: "0208", identifier: "1234567894" };
const EMAIL_TO = "accounting@buyer.example";
const RAW_XML_BILLING_ONLY =
  "A raw XML document can only be sent without a Peppol recipient when it is an invoice, credit note, self-billing invoice or self-billing credit note in a supported format.";

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

function context(input: unknown) {
  return {
    req: { valid: () => sendDocumentSchema.parse(input) },
    var: { company, team: { id: "team_1", isPlayground: false, useTestNetwork: false } },
    set: () => {},
    json: (body: any, status = 200) => ({ body, status }),
  } as any;
}

const send = (input: unknown) =>
  sendingPipeline(context(input)) as unknown as Promise<{ body: any; status: number }>;

/** A document as its sender's own software would write it, addressed to the buyer. */
async function writtenXml(
  documentType = "invoice",
  document: unknown = invoiceDocument(),
  doctypeId?: string,
): Promise<string> {
  const prepared = await prepareJsonDocument({
    input: sendDocumentSchema.parse({ recipient: BUYER, documentType, document, doctypeId }) as any,
    company,
    senderAddress: `${SENDER.scheme}:${SENDER.identifier}`,
    recipientAddress: BUYER,
    documentId: "doc_raw",
  });
  return prepared.xml!;
}

const invoiceXml = () => writtenXml();

const FRENCH_UBL_CIUS = "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0";

const messageLevelResponse = `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:fdc:peppol.eu:poacc:trns:mlr:3</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:poacc:bis:mlr:3</cbc:ProfileID>
  <cbc:ID>01a01a79-a85b-7000-9ab1-f68bee172d1a</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
  <cac:SenderParty>
    <cbc:EndpointID schemeID="0208">1234567894</cbc:EndpointID>
  </cac:SenderParty>
  <cac:ReceiverParty>
    <cbc:EndpointID schemeID="0208">0598726857</cbc:EndpointID>
  </cac:ReceiverParty>
  <cac:DocumentResponse>
    <cac:Response>
      <cbc:ResponseCode>AP</cbc:ResponseCode>
    </cac:Response>
    <cac:DocumentReference>
      <cbc:ID>01a01a79-a85b-7000-9ab1-f68bee172d1b</cbc:ID>
    </cac:DocumentReference>
  </cac:DocumentResponse>
</ApplicationResponse>`;

// XRechnung 2.3, which no registered format reads: it is only ever passed through.
const unreadableInvoice = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_2.3</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>PASSTHROUGH-1</cbc:ID>
</Invoice>`;

let spies: { mockRestore(): void }[] = [];
let sentEmails: { to: string; xmlDocument: string | null }[];
let recorded: any[];
let sendAs4: ReturnType<typeof mock>;
let validate: ReturnType<typeof spyOn>;

function stub<T extends object, K extends keyof T>(module: T, name: K) {
  const spy = spyOn(module, name as any);
  spies.push(spy);
  return spy;
}

beforeEach(() => {
  sentEmails = [];
  recorded = [];
  sendAs4 = mock(async () => ({ ok: true }));
  stub(companyIdentifiers, "getSendingCompanyIdentifier").mockResolvedValue(SENDER as any);
  validate = stub(validation, "validateDocument").mockResolvedValue({ result: "valid", errors: [] } as any);
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

describe("raw XML without a Peppol recipient", () => {
  it("emails an invoice exactly as given, validated and stored, without a Peppol attempt", async () => {
    const xml = await invoiceXml();

    const response = await send({ recipient: null, documentType: "xml", document: xml, email: { to: [EMAIL_TO] } });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, sentOverPeppol: false, sentOverEmail: true, emailRecipients: [EMAIL_TO] });
    expect(sendAs4).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledWith(xml, expect.any(String));
    expect(sentEmails).toEqual([{ to: EMAIL_TO, xmlDocument: xml }]);
    expect(recorded[0].document).toMatchObject({ type: "invoice", receiverId: null, xml });
  });

  for (const [name, xml, type] of [
    ["a self-billing invoice", () => writtenXml("selfBillingInvoice", selfBillingInvoiceDocument()), "selfBillingInvoice"],
    ["a CII invoice", () => writtenXml("invoice", invoiceDocument(), DOC_TYPE_ID.ciiInvoice), "invoice"],
  ] as const) {
    it(`emails ${name} as given, stored as the type it is read as`, async () => {
      const document = await xml();

      const response = await send({ recipient: null, documentType: "xml", document, email: { to: [EMAIL_TO] } });

      expect(response.status).toBe(200);
      expect(sentEmails).toEqual([{ to: EMAIL_TO, xmlDocument: document }]);
      expect(recorded[0].document).toMatchObject({ type, receiverId: null, xml: document });
    });
  }

  it("refuses a French regulated document because it cannot go by email only, before asking about the company's setup", async () => {
    // A Belgian company, which is not set up for the French flows either.
    const french = (await invoiceXml()).replace(
      /<cbc:CustomizationID>[^<]*<\/cbc:CustomizationID>/,
      `<cbc:CustomizationID>${FRENCH_UBL_CIUS}</cbc:CustomizationID>`,
    );

    const response = await send({ recipient: null, documentType: "xml", document: french, email: { to: [EMAIL_TO] } });

    expect(response.status).toBe(400);
    expect(response.body.errors.root).toEqual([
      "French regulated documents cannot be delivered by email only. Send them to a Peppol recipient.",
    ]);
    expect(sentEmails).toEqual([]);
  });

  it("refuses an invoice in a known format that cannot be read with the rules it breaks, not for its type", async () => {
    // Peppol BIS by its customization, but without the seller it needs to be read.
    const broken = (await invoiceXml()).replace(/<cac:AccountingSupplierParty>[\s\S]*?<\/cac:AccountingSupplierParty>/, "");
    validate.mockImplementation(async () => {
      throw new SendingFailure({ "cac:AccountingSupplierParty": ["[BR-06] Seller name is missing"] }, 400);
    });

    const response = await send({ recipient: null, documentType: "xml", document: broken, email: { to: [EMAIL_TO] } });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual({ "cac:AccountingSupplierParty": ["[BR-06] Seller name is missing"] });
    expect(sentEmails).toEqual([]);
  });

  it("refuses a document that is not a billing document", async () => {
    const response = await send({
      recipient: null,
      documentType: "xml",
      document: messageLevelResponse,
      email: { to: [EMAIL_TO] },
    });

    expect(response.status).toBe(400);
    expect(response.body.errors.root).toEqual([RAW_XML_BILLING_ONLY]);
    expect(sentEmails).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("refuses XML that none of the supported formats reads, whose type is unknown", async () => {
    const response = await send({
      recipient: null,
      documentType: "xml",
      document: unreadableInvoice,
      // Without a format to read it, the process has to be named, as for any passthrough.
      processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
      email: { to: [EMAIL_TO] },
    });

    expect(response.status).toBe(400);
    expect(response.body.errors.root).toEqual([RAW_XML_BILLING_ONLY]);
    expect(sentEmails).toEqual([]);
  });
});
