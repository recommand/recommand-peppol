import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import { createHash } from "crypto";

// Sending to a German business under its GEBA (0246) takes the path any other
// recipient takes: the SML lookup hashes the full 0246 address, the SMP is asked for
// that participant, the document names it as the buyer's endpoint and the access point
// gets it as the receiver. A German sender that holds a GEBA itself still sends under
// its VAT number (9930). Only DNS, the SMP and the access point are scripted.

mock.module("@recommand/db", () => ({ db: {} }));
const naptrLookups: string[] = [];
// Spied on rather than replaced as a module: a module mock lasts for the whole test run
// and would hand its stand-in to the files that test the real lookups.
const naptr = await import("../utils/naptr");
const naptrSpy = spyOn(naptr, "resolveNaptr").mockImplementation(async (domain: string) => {
  naptrLookups.push(domain);
  return { status: "found", smpUrl: "https://smp.example" };
});

const { base32Encode } = await import("../utils/base32");
const { chooseSendingCompanyIdentifier } = await import("../data/company-identifiers");
const { getRecipientCapabilities } = await import("../data/recipient-capabilities");
const { prepareJsonDocument } = await import("../utils/pipelines/sending/prepare-json-document");
const { sendDocumentSchema } = await import("../utils/parsing/send-document");
const { readEnvelopeParties } = await import("../utils/pipelines/sending/envelope-parties");
const { sendAs4 } = await import("../data/phase4-ap/client");
const { invoiceDocument } = await import("./e2e/documents");

const BIS_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const BIS_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const RECIPIENT = "0246:DE811569869";

const requests: { url: string; method?: string }[] = [];
const fetchMock = spyOn(globalThis, "fetch");
fetchMock.mockImplementation(
  Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method });
      if (url.startsWith("https://ap.net.recommand.com/")) {
        return Response.json({ overallSuccess: true, as4MessageId: "msg-1", sbdhInstanceIdentifier: "sbdh-1" });
      }
      const participant = decodeURIComponent(url).match(/iso6523-actorid-upis::([^/]+)/)?.[1];
      if (participant?.toLowerCase() !== RECIPIENT.toLowerCase()) {
        return new Response("Not found", { status: 404 });
      }
      if (url.includes("/services/")) {
        return new Response(`
          <ServiceMetadata><ServiceInformation><ProcessList><Process>
            <ProcessIdentifier scheme="cenbii-procid-ubl">${BIS_PROCESS}</ProcessIdentifier>
            <ServiceEndpointList><Endpoint><EndpointReference><Address>https://ap.example/as4</Address></EndpointReference></Endpoint></ServiceEndpointList>
          </Process></ProcessList></ServiceInformation></ServiceMetadata>`);
      }
      const reference = `https://smp.example/iso6523-actorid-upis%3A%3A${encodeURIComponent(participant)}/services/busdox-docid-qns%3A%3A${encodeURIComponent(BIS_INVOICE)}`;
      return new Response(`
        <ServiceGroup><ServiceMetadataReferenceCollection>
          <ServiceMetadataReference href="${reference}"/>
        </ServiceMetadataReferenceCollection></ServiceGroup>`);
    },
    { preconnect: globalThis.fetch.preconnect },
  ),
);

afterAll(() => {
  fetchMock.mockRestore();
  naptrSpy.mockRestore();
});

const germanCompany = {
  id: "c_de",
  name: "Beispiel GmbH",
  address: "Musterstraße 1",
  city: "Berlin",
  postalCode: "10115",
  country: "DE",
  vatNumber: "DE136695976",
  enterpriseNumber: "HRB12345",
  enterpriseNumberScheme: null,
  email: null,
  phone: null,
  accessPointProvider: "recommand-ap1",
} as any;
// The company's identifiers in the order getCompanyIdentifiers lists them.
const germanIdentifiers = [
  { scheme: "0246", identifier: "de136695976" },
  { scheme: "9930", identifier: "de136695976" },
];

describe("sending to a GEBA", () => {
  it("looks the recipient up, writes it as the buyer and hands it to the access point, from the VAT number", async () => {
    const sender = chooseSendingCompanyIdentifier(germanCompany, germanIdentifiers, RECIPIENT);
    expect(sender).toEqual({ scheme: "9930", identifier: "de136695976" });
    const senderAddress = `${sender.scheme}:${sender.identifier}`;

    const capabilities = await getRecipientCapabilities({
      recipientAddress: RECIPIENT,
      isPlayground: false,
      useTestNetwork: false,
      teamId: "team_de",
    });
    const hash = base32Encode(createHash("sha256").update("0246:de811569869").digest()).replace(/=+$/, "").toLowerCase();
    expect(naptrLookups).toEqual([`${hash}.iso6523-actorid-upis.participant.sml.prod.tech.peppol.org`]);
    expect(requests[0]!.url).toBe("https://smp.example/iso6523-actorid-upis::0246%3ADE811569869");
    expect(capabilities?.supportsDocType(BIS_INVOICE)).toBe(true);

    const input = sendDocumentSchema.parse({ recipient: RECIPIENT, documentType: "invoice", document: invoiceDocument() });
    const prepared = await prepareJsonDocument({
      input,
      company: germanCompany,
      senderAddress,
      recipientAddress: RECIPIENT,
      documentId: "doc_geba",
      recipientCapabilities: capabilities,
    });
    expect(prepared.docTypeId).toBe(BIS_INVOICE);
    expect(prepared.processId).toBe(BIS_PROCESS);
    expect(prepared.xml).toContain(`<cbc:EndpointID schemeID="0246">DE811569869</cbc:EndpointID>`);
    expect(prepared.xml).toContain(`<cbc:EndpointID schemeID="9930">DE136695976</cbc:EndpointID>`);
    expect(readEnvelopeParties(prepared.xml)).toMatchObject({
      sender: { participant: { scheme: "9930", identifier: "DE136695976" } },
      receiver: { participant: { scheme: "0246", identifier: "DE811569869" } },
    });

    const sent = await sendAs4({
      senderId: senderAddress,
      receiverId: RECIPIENT,
      docTypeId: prepared.docTypeId,
      processId: prepared.processId,
      countryC1: "DE",
      body: prepared.body,
      useTestNetwork: false,
    });
    expect(sent.ok).toBe(true);
    const handOff = requests.find((request) => request.url.startsWith("https://ap.net.recommand.com/"));
    expect(handOff?.url).toBe(
      `https://ap.net.recommand.com//sendas4/9930%3Ade136695976/0246%3ADE811569869/${encodeURIComponent(BIS_INVOICE)}/${encodeURIComponent(BIS_PROCESS)}/DE`
    );
  });
});
