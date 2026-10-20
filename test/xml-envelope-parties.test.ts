/**
 * Raw XML and the envelope it travels in.
 *
 * The Peppol BIS Billing enveloping rules (BR-SBDH-1 to BR-SBDH-4) have the
 * receiving access point compare the envelope's sender and receiver with the
 * endpoints of a BIS Billing or Self-Billing invoice or credit note, character
 * for character. A send is refused up front only when the document names
 * another participant than the one the transmission goes from or to. The same
 * participant written in other case or spacing goes out with the document's
 * spelling on the envelope instead, and every document the rules do not cover
 * is passed through as before.
 */

import { describe, expect, it, mock } from "bun:test";

// Nothing under test touches the database, but some of the modules connect at
// import time.
mock.module("@recommand/db", () => ({ db: {} }));

const { SendingFailure } = await import("../utils/pipelines/sending/errors");
const { matchEnvelopeToDocument, readEnvelopeParties } = await import(
  "../utils/pipelines/sending/envelope-parties"
);
const { chooseSendingCompanyIdentifier } = await import("../data/company-identifiers");
const { prepareJsonDocument } = await import("../utils/pipelines/sending/prepare-json-document");
const { sendDocumentSchema } = await import("../utils/parsing/send-document");
const {
  creditNoteDocument,
  invoiceDocument,
  selfBillingCreditNoteDocument,
  selfBillingInvoiceDocument,
} = await import("./e2e/documents");

const BILLING = {
  customizationId: "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
  profileId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
};
const SELF_BILLING = {
  customizationId: "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0",
  profileId: "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0",
};

type Endpoint = { scheme?: string; id: string } | null;

function endpoint(value: Endpoint): string {
  if (!value) return "";
  const scheme = value.scheme === undefined ? "" : ` schemeID="${value.scheme}"`;
  return `<cbc:EndpointID${scheme}>${value.id}</cbc:EndpointID>`;
}

function ubl(options: {
  root?: "Invoice" | "CreditNote";
  supplier: Endpoint;
  customer: Endpoint;
  profile?: { customizationId: string; profileId: string };
}): string {
  const root = options.root ?? "Invoice";
  const profile = options.profile ?? BILLING;
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${profile.customizationId}</cbc:CustomizationID>
  <cbc:ProfileID>${profile.profileId}</cbc:ProfileID>
  <cbc:ID>DOC-1</cbc:ID>
  <cac:AccountingSupplierParty>
    <cac:Party>${endpoint(options.supplier)}</cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>${endpoint(options.customer)}</cac:Party>
  </cac:AccountingCustomerParty>
</${root}>`;
}

const us = { scheme: "0208", id: "0795374462" };
const them = { scheme: "9938", id: "LU12345678" };
const transmission = {
  senderAddress: "0208:0795374462",
  recipientAddress: "9938:lu12345678",
  checkReceiver: true,
};

function envelopeFor(xml: string, sentBetween = transmission) {
  return matchEnvelopeToDocument(readEnvelopeParties(xml), sentBetween);
}

function refusal(xml: string, sentBetween = transmission): string[] {
  try {
    envelopeFor(xml, sentBetween);
  } catch (error) {
    expect(error).toBeInstanceOf(SendingFailure);
    const failure = error as InstanceType<typeof SendingFailure>;
    expect(failure.status).toBe(400);
    return (failure.payload as Record<string, string[]>).root;
  }
  throw new Error("Expected the document to be refused");
}

describe("the envelope of a raw XML invoice or credit note", () => {
  it("takes the document's spelling of the same participants", () => {
    expect(envelopeFor(ubl({ supplier: us, customer: them }))).toEqual({
      senderId: "0208:0795374462",
      receiverId: "9938:LU12345678",
    });
    expect(
      envelopeFor(ubl({ supplier: { scheme: "9925", id: "BE0795374462" }, customer: { scheme: "9938", id: " LU12345678 " } }), {
        senderAddress: "9925:be0795374462",
        recipientAddress: "iso6523-actorid-upis::9938:lu12345678",
        checkReceiver: true,
      })
    ).toEqual({ senderId: "9925:BE0795374462", receiverId: "9938:LU12345678" });
  });

  it("refuses a customer endpoint naming another participant than the recipient", () => {
    const messages = refusal(
      ubl({ supplier: us, customer: { scheme: "0002", id: "accounting@example.com" } })
    );

    expect(messages).toEqual([
      "The sender and receiver in the document do not match the Peppol sender and recipient it is sent between (Peppol BIS Billing rules BR-SBDH-1 to BR-SBDH-4). The receiving access point compares them and would reject the document.",
      'The document names 0002:accounting@example.com as its receiver in AccountingCustomerParty/Party/EndpointID, but the request sends it to 9938:lu12345678. Write the recipient\'s Peppol address there (schemeID "9938", value "lu12345678"), or set `recipient` to the address the document names.',
    ]);
  });

  it("refuses a supplier endpoint that is not the company's", () => {
    const messages = refusal(ubl({ supplier: { scheme: "0208", id: "1012081766" }, customer: them }));

    expect(messages[1]).toBe(
      'The document names 0208:1012081766 as its sender in AccountingSupplierParty/Party/EndpointID, which is not a Peppol identifier of this company. Write one of the company\'s identifiers there, such as 0208:0795374462 (schemeID "0208", value "0795374462").'
    );
  });

  it("reports both sides when both are wrong", () => {
    const messages = refusal(ubl({ supplier: them, customer: us }));

    expect(messages).toHaveLength(3);
    expect(messages[1]).toContain("as its sender");
    expect(messages[2]).toContain("as its receiver");
  });

  it("reads a credit note like an invoice", () => {
    expect(envelopeFor(ubl({ root: "CreditNote", supplier: us, customer: them })).receiverId).toBe("9938:LU12345678");
    expect(refusal(ubl({ root: "CreditNote", supplier: us, customer: us }))[1]).toContain("as its receiver");
  });

  it("reads a self-billing document as travelling from the customer to the supplier", () => {
    for (const root of ["Invoice", "CreditNote"] as const) {
      expect(envelopeFor(ubl({ root, supplier: them, customer: us, profile: SELF_BILLING }))).toEqual({
        senderId: "0208:0795374462",
        receiverId: "9938:LU12345678",
      });
      expect(refusal(ubl({ root, supplier: us, customer: them, profile: SELF_BILLING }))[1]).toContain(
        "as its sender in AccountingCustomerParty/Party/EndpointID"
      );
    }
  });

  it("covers billing with response like billing", () => {
    const withResponse = { ...BILLING, profileId: "urn:peppol:bis:billing_with_response" };
    expect(refusal(ubl({ supplier: us, customer: us, profile: withResponse }))[1]).toContain("as its receiver");
  });

  it("keeps leading zeros", () => {
    expect(readEnvelopeParties(ubl({ supplier: us, customer: them }))?.sender?.participant).toEqual({
      scheme: "0208",
      identifier: "0795374462",
    });
  });

  it("leaves the receiver alone when the recipient's scheme was assumed", () => {
    expect(
      envelopeFor(ubl({ supplier: us, customer: { scheme: "9925", id: "BE0598726857" } }), {
        senderAddress: "0208:0795374462",
        recipientAddress: "0208:0598726857",
        checkReceiver: false,
      })
    ).toEqual({ senderId: "0208:0795374462", receiverId: "0208:0598726857" });
  });

  it("leaves alone a side the document does not state in full", () => {
    for (const xml of [
      ubl({ supplier: null, customer: null }),
      ubl({ supplier: { id: "0795374462" }, customer: { id: "accounting@example.com" } }),
      ubl({ supplier: { scheme: "0208", id: " " }, customer: { scheme: "", id: "x" } }),
    ]) {
      expect(envelopeFor(xml)).toEqual({ senderId: "0208:0795374462", receiverId: "9938:lu12345678" });
    }
  });

  it("leaves alone every document the enveloping rules do not cover", () => {
    const wrongCustomer = { supplier: us, customer: { scheme: "0002", id: "accounting@example.com" } };
    for (const xml of [
      // Another specification, a CIUS or an extension of the BIS
      ubl({ ...wrongCustomer, profile: { ...BILLING, customizationId: "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0" } }),
      ubl({ ...wrongCustomer, profile: { ...BILLING, customizationId: `${BILLING.customizationId}#conformant#urn:some:extension` } }),
      ubl({ ...wrongCustomer, profile: { ...BILLING, customizationId: "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0" } }),
      // The BIS customization under another process
      ubl({ ...wrongCustomer, profile: { ...BILLING, profileId: "urn:peppol:france:billing:regulated" } }),
      // Another syntax or document
      `<?xml version="1.0"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"><rsm:SupplyChainTradeTransaction><ram:ApplicableHeaderTradeAgreement><ram:BuyerTradeParty><ram:URIUniversalCommunication><ram:URIID schemeID="0002">accounting@example.com</ram:URIID></ram:URIUniversalCommunication></ram:BuyerTradeParty></ram:ApplicableHeaderTradeAgreement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>`,
      `<?xml version="1.0"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:CustomizationID>urn:fdc:peppol.eu:poacc:trns:mlr:3</cbc:CustomizationID><cac:ReceiverParty><cbc:EndpointID schemeID="0208">1012081766</cbc:EndpointID></cac:ReceiverParty></ApplicationResponse>`,
      `<?xml version="1.0"?><Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"/>`,
      "this is not an xml document",
    ]) {
      expect(readEnvelopeParties(xml)).toBeUndefined();
      expect(envelopeFor(xml)).toEqual({ senderId: "0208:0795374462", receiverId: "9938:lu12345678" });
    }
  });
});

describe("the address a raw XML document is sent from", () => {
  const belgianCompany = { accessPointProvider: "recommand-ap1" } as const;
  const frenchCompany = { accessPointProvider: "at-shared-ap-fr" } as const;
  const enterpriseNumber = { scheme: "0208", identifier: "0795374462" };
  const vat = { scheme: "9925", identifier: "be0795374462" };
  const gln = { scheme: "0088", identifier: "5400000000003" };
  const siren = { scheme: "0225", identifier: "443061841" };

  it("is the company identifier the document names, rather than the one it would default to", () => {
    expect(chooseSendingCompanyIdentifier(belgianCompany, [gln, enterpriseNumber, vat])).toBe(gln);
    expect(
      chooseSendingCompanyIdentifier(belgianCompany, [gln, enterpriseNumber, vat], "9938:lu12345678", {
        scheme: "9925",
        identifier: "BE0795374462",
      })
    ).toBe(vat);
  });

  it("is chosen as before when the document names an address that is not the company's", () => {
    expect(
      chooseSendingCompanyIdentifier(belgianCompany, [gln, enterpriseNumber, vat], "9938:lu12345678", {
        scheme: "0208",
        identifier: "1012081766",
      })
    ).toBe(gln);
  });

  it("stays the SIREN through the French access point", () => {
    expect(
      chooseSendingCompanyIdentifier(frenchCompany, [enterpriseNumber, siren], "0225:552081317", enterpriseNumber)
    ).toBe(siren);
  });
});

describe("documents written from JSON", () => {
  // The JSON path writes the endpoints from the addresses it sends between, so the
  // envelope always matches, whatever case the recipient is given in.
  const company = {
    id: "c_test",
    name: "Recommand Test",
    address: "Teststraat 1",
    city: "Brussels",
    postalCode: "1000",
    country: "BE",
    vatNumber: "BE0795374462",
    enterpriseNumber: "0795374462",
    enterpriseNumberScheme: "0208",
    email: null,
    phone: null,
    accessPointProvider: "recommand-ap1",
  } as any;

  for (const [documentType, document] of [
    ["invoice", invoiceDocument],
    ["creditNote", creditNoteDocument],
    ["selfBillingInvoice", selfBillingInvoiceDocument],
    ["selfBillingCreditNote", selfBillingCreditNoteDocument],
  ] as const) {
    it(`always match their envelope: ${documentType}`, async () => {
      for (const recipientAddress of ["9938:LU12345678", "9938:lu12345678", "0208:0598726857"]) {
        const input = sendDocumentSchema.parse({ recipient: recipientAddress, documentType, document: document() });
        const prepared = await prepareJsonDocument({
          input,
          company,
          senderAddress: "0208:0795374462",
          recipientAddress,
          documentId: "doc_test",
          recipientCapabilities: null,
        });

        const parties = readEnvelopeParties(prepared.xml);
        expect(parties?.sender).not.toBeNull();
        expect(parties?.receiver).not.toBeNull();
        expect(() =>
          matchEnvelopeToDocument(parties, {
            senderAddress: "0208:0795374462",
            recipientAddress,
            checkReceiver: true,
          })
        ).not.toThrow();
      }
    });
  }
});
