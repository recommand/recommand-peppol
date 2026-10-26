/**
 * Raw XML and the envelope it travels in.
 *
 * The Peppol BIS Billing enveloping rules (BR-SBDH-1 to BR-SBDH-4) want the
 * envelope's sender and receiver to be the endpoints a BIS Billing or
 * Self-Billing invoice or credit note names. A send is refused up front only
 * where a difference cannot be right: a receiver that is not a valid
 * identifier at all, or a sender that is another company's number. Anything
 * else, case included, goes out as before, and the check fails open.
 */

import { describe, expect, it, mock, spyOn } from "bun:test";

// Nothing under test touches the database, but some of the modules connect at
// import time.
mock.module("@recommand/db", () => ({ db: {} }));

const { SendingFailure } = await import("../utils/pipelines/sending/errors");
const { assertEnvelopePartiesPlausible, readEnvelopeParties } = await import(
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

const company: { country: string; enterpriseNumber: string | null; vatNumber: string | null } = {
  country: "BE",
  enterpriseNumber: "0795374462",
  vatNumber: "BE0795374462",
};
const us = { scheme: "0208", id: "0795374462" };
const them = { scheme: "9938", id: "LU12345613" };
const transmission = {
  senderAddress: "0208:0795374462",
  recipientAddress: "9938:lu12345613",
  company,
  checkSender: true,
};

function check(xml: string, overrides: Partial<typeof transmission> = {}) {
  return () => assertEnvelopePartiesPlausible(readEnvelopeParties(xml), { ...transmission, ...overrides });
}

function refusal(xml: string, overrides: Partial<typeof transmission> = {}): string[] {
  try {
    check(xml, overrides)();
  } catch (error) {
    expect(error).toBeInstanceOf(SendingFailure);
    const failure = error as InstanceType<typeof SendingFailure>;
    expect(failure.status).toBe(400);
    return (failure.payload as Record<string, string[]>).root;
  }
  throw new Error("Expected the document to be refused");
}

const GENERAL =
  "The sender or receiver in the document cannot be the Peppol participant it is sent between. Peppol BIS Billing requires the document's party endpoints to match the envelope (rules BR-SBDH-1 to BR-SBDH-4), and the receiving access point may reject the document otherwise.";

describe("the receiver of a raw XML invoice or credit note", () => {
  it("is refused when it is not the recipient and not a valid identifier under its scheme", () => {
    expect(refusal(ubl({ supplier: us, customer: { scheme: "0002", id: "accounting@example.com" } }))).toEqual([
      GENERAL,
      'The document names 0002:accounting@example.com as its receiver in AccountingCustomerParty/Party/EndpointID, which is not a valid identifier under scheme 0002. Write the recipient\'s Peppol address there, such as 9938:lu12345613 (schemeID "9938", value "lu12345613").',
    ]);
  });

  it("is accepted when it is the recipient in other case or spacing", () => {
    expect(check(ubl({ supplier: us, customer: them }))).not.toThrow();
    expect(check(ubl({ supplier: us, customer: { scheme: "9938", id: " lu12345613 " } }))).not.toThrow();
    expect(
      check(ubl({ supplier: us, customer: them }), { recipientAddress: "iso6523-actorid-upis::9938:LU12345613" })
    ).not.toThrow();
  });

  it("is accepted when it is another valid identifier, as many recipients have more than one", () => {
    const recipient = { recipientAddress: "0208:0598726857" };
    expect(check(ubl({ supplier: us, customer: { scheme: "9925", id: "BE0598726857" } }), recipient)).not.toThrow();
    expect(check(ubl({ supplier: us, customer: { scheme: "0208", id: "1012081766" } }), recipient)).not.toThrow();
    expect(check(ubl({ supplier: us, customer: { scheme: "0002", id: "443061841" } }))).not.toThrow();
  });

  it("is accepted under a scheme the platform does not validate", () => {
    expect(check(ubl({ supplier: us, customer: { scheme: "0190", id: "not-checked-here" } }))).not.toThrow();
  });
});

describe("the sender of a raw XML invoice or credit note", () => {
  it("is refused when it is another company's number in the company's country", () => {
    expect(refusal(ubl({ supplier: { scheme: "0208", id: "1012081766" }, customer: them }))[1]).toBe(
      'The document names 0208:1012081766 as its sender in AccountingSupplierParty/Party/EndpointID, which is another company\'s number. Write one of this company\'s Peppol identifiers there, such as 0208:0795374462 (schemeID "0208", value "0795374462").'
    );
    expect(refusal(ubl({ supplier: { scheme: "9925", id: "BE1012081766" }, customer: them }))[1]).toContain(
      "names 9925:BE1012081766 as its sender"
    );
  });

  it("is accepted when it is the company's own number under another scheme, registered or not", () => {
    expect(check(ubl({ supplier: { scheme: "9925", id: "BE0795374462" }, customer: them }))).not.toThrow();
    expect(check(ubl({ supplier: { scheme: "0208", id: "0795.374.462" }, customer: them }))).not.toThrow();
  });

  it("is accepted when it cannot be told to be someone else", () => {
    for (const supplier of [
      // Not a valid number at all
      { scheme: "0208", id: "1234567890" },
      // A number from another country, or under a scheme that names no national number
      { scheme: "9944", id: "NL000099998B57" },
      { scheme: "0088", id: "5400000000003" },
    ]) {
      expect(check(ubl({ supplier, customer: them }))).not.toThrow();
    }
    // A company without a number of that kind
    expect(
      check(ubl({ supplier: { scheme: "0208", id: "1012081766" }, customer: them }), {
        company: { ...company, enterpriseNumber: null },
      })
    ).not.toThrow();
  });

  it("is accepted when it is the company's own number and the company's number is stored in another form", () => {
    // A VAT number stored without its country prefix, and an enterprise number stored with it.
    const stored = { ...company, vatNumber: "0795374462", enterpriseNumber: "BE0795374462" };
    for (const supplier of [
      { scheme: "9925", id: "BE0795374462" },
      { scheme: "0208", id: "0795374462" },
    ]) {
      expect(
        check(ubl({ supplier, customer: them }), { senderAddress: "0088:5400000000003", company: stored })
      ).not.toThrow();
    }
  });

  it("is not checked when the caller says so", () => {
    expect(
      check(ubl({ supplier: { scheme: "0208", id: "1012081766" }, customer: them }), { checkSender: false })
    ).not.toThrow();
  });
});

describe("the parties of a raw XML document", () => {
  it("are both reported when both are wrong", () => {
    const messages = refusal(
      ubl({ supplier: { scheme: "0208", id: "1012081766" }, customer: { scheme: "0002", id: "accounting@example.com" } })
    );

    expect(messages).toHaveLength(3);
    expect(messages[1]).toContain("as its sender");
    expect(messages[2]).toContain("as its receiver");
  });

  it("are read from a credit note like from an invoice", () => {
    expect(refusal(ubl({ root: "CreditNote", supplier: us, customer: { scheme: "0002", id: "x@example.com" } }))[1]).toContain(
      "as its receiver"
    );
  });

  it("are read from a self-billing document as travelling from the customer to the supplier", () => {
    for (const root of ["Invoice", "CreditNote"] as const) {
      expect(check(ubl({ root, supplier: them, customer: us, profile: SELF_BILLING }))).not.toThrow();
      const messages = refusal(
        ubl({
          root,
          supplier: { scheme: "0002", id: "x@example.com" },
          customer: { scheme: "0208", id: "1012081766" },
          profile: SELF_BILLING,
        })
      );
      expect(messages[1]).toContain("as its sender in AccountingCustomerParty/Party/EndpointID");
      expect(messages[2]).toContain("as its receiver in AccountingSupplierParty/Party/EndpointID");
    }
  });

  it("are read from billing with response like from billing", () => {
    const withResponse = { ...BILLING, profileId: "urn:peppol:bis:billing_with_response" };
    expect(refusal(ubl({ supplier: us, customer: { scheme: "0002", id: "x@example.com" }, profile: withResponse }))).toHaveLength(2);
  });

  it("keep leading zeros", () => {
    expect(readEnvelopeParties(ubl({ supplier: us, customer: them }))?.sender?.participant).toEqual({
      scheme: "0208",
      identifier: "0795374462",
    });
  });

  it("are left alone where the document does not state them in full", () => {
    for (const xml of [
      ubl({ supplier: null, customer: null }),
      ubl({ supplier: { id: "1012081766" }, customer: { id: "accounting@example.com" } }),
      ubl({ supplier: { scheme: "0208", id: " " }, customer: { scheme: "", id: "x" } }),
    ]) {
      expect(check(xml)).not.toThrow();
    }
  });

  it("are not read from a document the enveloping rules do not cover", () => {
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
      `<?xml version="1.0"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:CustomizationID>urn:fdc:peppol.eu:poacc:trns:mlr:3</cbc:CustomizationID><cac:ReceiverParty><cbc:EndpointID schemeID="0002">accounting@example.com</cbc:EndpointID></cac:ReceiverParty></ApplicationResponse>`,
      `<?xml version="1.0"?><Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"/>`,
      "this is not an xml document",
    ]) {
      expect(readEnvelopeParties(xml)).toBeUndefined();
      expect(check(xml)).not.toThrow();
    }
  });

  it("fail open: an unexpected error in the check is logged and the send goes on", () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const broken = { sender: { participant: null, element: "x" }, receiver: null } as any;
      expect(() => assertEnvelopePartiesPlausible(broken, transmission)).not.toThrow();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0]?.[0])).toContain("Failed to check the parties of an XML document");
    } finally {
      logged.mockRestore();
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
      chooseSendingCompanyIdentifier(belgianCompany, [gln, enterpriseNumber, vat], "9938:lu12345613", {
        scheme: "9925",
        identifier: "BE0795374462",
      })
    ).toBe(vat);
  });

  it("is chosen as before when the document names an address that is not the company's", () => {
    expect(
      chooseSendingCompanyIdentifier(belgianCompany, [gln, enterpriseNumber, vat], "9938:lu12345613", {
        scheme: "0208",
        identifier: "1012081766",
      })
    ).toBe(gln);
  });

  it("follows the document to a Leitweg-ID only for a VAT number or GLN", () => {
    const germanVat = { scheme: "9930", identifier: "de811569869" };
    const geba = { scheme: "0246", identifier: "0123456789012" };
    const germanGln = { scheme: "0088", identifier: "4000001000005" };
    const toAuthority = "0204:991-33333test-33";

    expect(
      chooseSendingCompanyIdentifier(belgianCompany, [geba, germanVat], toAuthority, { scheme: "0246", identifier: "0123456789012" })
    ).toBe(germanVat);
    expect(
      chooseSendingCompanyIdentifier(belgianCompany, [germanGln, geba, germanVat], toAuthority, {
        scheme: "0088",
        identifier: "4000001000005",
      })
    ).toBe(germanGln);
    expect(chooseSendingCompanyIdentifier(belgianCompany, [germanGln, geba, germanVat], toAuthority)).toBe(germanVat);
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
  const sendingCompany = {
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
      for (const recipientAddress of ["9938:LU12345613", "9938:lu12345613", "0208:0598726857"]) {
        const input = sendDocumentSchema.parse({ recipient: recipientAddress, documentType, document: document() });
        const prepared = await prepareJsonDocument({
          input,
          company: sendingCompany,
          senderAddress: "0208:0795374462",
          recipientAddress,
          documentId: "doc_test",
          recipientCapabilities: null,
        });

        const parties = readEnvelopeParties(prepared.xml);
        expect(parties?.sender).not.toBeNull();
        expect(parties?.receiver).not.toBeNull();
        expect(() =>
          assertEnvelopePartiesPlausible(parties, {
            senderAddress: "0208:0795374462",
            recipientAddress,
            company,
            checkSender: true,
          })
        ).not.toThrow();
      }
    });
  }
});
