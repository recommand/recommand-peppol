/**
 * A document emailed without a Peppol recipient, in a format the caller named.
 *
 * It is written like any other structured document, so it needs an electronic address
 * for the party receiving it, which nobody gave us. That address is taken from the
 * document, or else from the email it goes out by. French regulated documents are not
 * delivered this way at all.
 */

import { describe, expect, it } from "bun:test";
import { SendingFailure } from "../utils/pipelines/sending/errors";
import { assertNotFranceRegulatedByEmailOnly } from "../utils/pipelines/sending/france-regulated-guard";
import { prepareJsonDocument } from "../utils/pipelines/sending/prepare-json-document";
import { validateDocument } from "../utils/pipelines/sending/validate-document";

const BIS3_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const BIS3_SELF_BILLING_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1";
const XRECHNUNG = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
const XRECHNUNG_UBL_INVOICE = `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${XRECHNUNG}::2.1`;
const XRECHNUNG_CII = `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##${XRECHNUNG}::D16B`;
const FRANCE_CIUS_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::2.1";

const BILLING_PROCESS_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

// Validating needs a validation service with the KoSIT XRechnung rules, as in
// xrechnung.test.ts: point VALIDATION_SERVICE_URL at one and set XRECHNUNG_VALIDATION=1.
const VALIDATE = process.env.XRECHNUNG_VALIDATION === "1";

const SENDER = "9930:de136695976";
const EMAIL_TO = ["Einkauf.Rechnung@kunde-gmbh.de", "buchhaltung@kunde-gmbh.de"];

const company = {
  id: "c_de",
  name: "Beispiel GmbH",
  address: "Musterstraße 1",
  postalCode: "10115",
  city: "Berlin",
  country: "DE",
  vatNumber: "DE136695976",
  enterpriseNumber: null,
  enterpriseNumberScheme: null,
  email: "rechnung@beispiel.de",
  phone: "+49 30 1234567",
  accessPointProvider: "recommand-ap1",
} as any;

const party = (overrides: Record<string, unknown> = {}) => ({
  name: "Kunde GmbH",
  street: "Amtsweg 2",
  city: "Bonn",
  postalZone: "53113",
  country: "DE",
  vatNumber: null,
  ...overrides,
});

const lines = [
  { name: "Beratung", quantity: "2", unitCode: "HUR", netPriceAmount: "95.00", vat: { category: "S", percentage: "19.00" } },
];
const paymentMeans = [{ paymentMethod: "credit_transfer", reference: "RE-2026-001", iban: "DE89370400440532013000" }];

function invoiceInput(buyer: Record<string, unknown>, doctypeId?: string) {
  return {
    documentType: "invoice",
    recipient: null,
    doctypeId,
    email: { when: "on_peppol_failure", to: EMAIL_TO },
    document: { invoiceNumber: "RE-2026-001", issueDate: "2026-10-01", buyerReference: "Abt. 4", buyer, lines, paymentMeans },
  } as any;
}

function prepare(input: any, { structured = true }: { structured?: boolean } = {}) {
  return prepareJsonDocument({
    input,
    company,
    senderAddress: SENDER,
    recipientAddress: null,
    documentId: "doc_email_structured",
    structuredEmailTo: structured ? input.email.to : undefined,
  });
}

const buyerEndpoint = (xml: string) =>
  xml.match(/<cac:AccountingCustomerParty>[\s\S]*?<cbc:EndpointID schemeID="([^"]+)">([^<]+)</)?.slice(1);
const sellerEndpoint = (xml: string) =>
  xml.match(/<cac:AccountingSupplierParty>[\s\S]*?<cbc:EndpointID schemeID="([^"]+)">([^<]+)</)?.slice(1);

describe("the receiving party's electronic address on a document emailed in a named format", () => {
  it("is the buyer's enterprise number under its scheme first", async () => {
    const prepared = await prepare(
      invoiceInput(
        party({ country: "BE", vatNumber: "BE1234567894", enterpriseNumberScheme: "0208", enterpriseNumber: "1234.567.894" }),
        BIS3_INVOICE
      )
    );

    expect(buyerEndpoint(prepared.xml)).toEqual(["0208", "1234567894"]);
  });

  it("is the buyer's VAT number under its country's VAT scheme otherwise", async () => {
    const prepared = await prepare(invoiceInput(party({ vatNumber: "DE 811 569 869" }), BIS3_INVOICE));

    expect(buyerEndpoint(prepared.xml)).toEqual(["9930", "DE811569869"]);
  });

  it("takes the country from the VAT number rather than the address", async () => {
    const austrian = await prepare(invoiceInput(party({ vatNumber: "ATU13585627" }), BIS3_INVOICE));
    expect(buyerEndpoint(austrian.xml)).toEqual(["9914", "ATU13585627"]);

    // Greece has no default VAT scheme here and its VAT numbers start with EL.
    const greek = await prepare(invoiceInput(party({ vatNumber: "EL094259216" }), BIS3_INVOICE));
    expect(buyerEndpoint(greek.xml)).toEqual(["9933", "EL094259216"]);
  });

  it("is the first email address when the buyer has neither number and the format takes one", async () => {
    const prepared = await prepare(invoiceInput(party(), XRECHNUNG_UBL_INVOICE));

    expect(buyerEndpoint(prepared.xml)).toEqual(["EM", "Einkauf.Rechnung@kunde-gmbh.de"]);
  });

  it("is written into a CII document as well", async () => {
    const prepared = await prepare(invoiceInput(party(), XRECHNUNG_CII));

    expect(prepared.xml).toContain('<ram:URIID schemeID="EM">Einkauf.Rechnung@kunde-gmbh.de</ram:URIID>');
  });

  it("refuses a Peppol BIS document for a buyer with neither number, saying what to add", async () => {
    const refused = prepare(invoiceInput(party(), BIS3_INVOICE));

    await expect(refused).rejects.toBeInstanceOf(SendingFailure);
    await expect(refused).rejects.toMatchObject({
      status: 400,
      message:
        "Peppol BIS documents need the buyer's electronic address, and do not accept an email address for it. Provide the buyer's vatNumber, or its enterpriseNumber and enterpriseNumberScheme, or choose a doctypeId that accepts an email address, such as XRechnung.",
    });
  });

  it("is the seller's on a self-billing invoice, which the seller receives", async () => {
    const prepared = await prepare({
      documentType: "selfBillingInvoice",
      recipient: null,
      doctypeId: BIS3_SELF_BILLING_INVOICE,
      email: { when: "on_peppol_failure", to: EMAIL_TO },
      document: {
        invoiceNumber: "SB-2026-001",
        issueDate: "2026-10-01",
        seller: party({ name: "Lieferant GmbH", vatNumber: "DE811569869" }),
        lines,
        paymentMeans,
      },
    });

    expect(sellerEndpoint(prepared.xml)).toEqual(["9930", "DE811569869"]);
    // The buyer is the company sending it, named by its own address.
    expect(buyerEndpoint(prepared.xml)).toEqual(["9930", "DE136695976"]);
  });

  it("stays the placeholder for a document that is not delivered as a structured document", async () => {
    const prepared = await prepare(invoiceInput(party({ vatNumber: "DE811569869" })), { structured: false });

    expect(buyerEndpoint(prepared.xml)).toEqual(["0000", "0000"]);
  });

  describe.skipIf(!VALIDATE)("against the validation rules", () => {
    it("writes valid Peppol BIS, XRechnung UBL and XRechnung CII documents", async () => {
      for (const [doctypeId, buyer] of [
        [BIS3_INVOICE, party({ vatNumber: "DE811569869" })],
        [XRECHNUNG_UBL_INVOICE, party()],
        [XRECHNUNG_CII, party()],
      ] as const) {
        const prepared = await prepare(invoiceInput(buyer, doctypeId));
        const validation = await validateDocument(prepared.xml, prepared.docTypeId);
        expect(validation.result, doctypeId).toBe("valid");
      }
    });
  });
});

describe("French regulated documents delivered by email only", () => {
  const refusal = {
    status: 400,
    message: "French regulated documents cannot be delivered by email only. Send them to a Peppol recipient.",
  };

  it("are refused in a French format", () => {
    expect(() =>
      assertNotFranceRegulatedByEmailOnly({ docTypeId: FRANCE_CIUS_INVOICE, processId: BILLING_PROCESS_ID })
    ).toThrow(expect.objectContaining(refusal));
  });

  it("are refused over the regulated process", () => {
    expect(() =>
      assertNotFranceRegulatedByEmailOnly({ docTypeId: BIS3_INVOICE, processId: "urn:peppol:france:billing:regulated" })
    ).toThrow(expect.objectContaining(refusal));
  });

  it("leave a Peppol BIS document alone, over the non-regulated process too", () => {
    for (const processId of [BILLING_PROCESS_ID, "urn:peppol:france:billing:non-regulated"]) {
      expect(() => assertNotFranceRegulatedByEmailOnly({ docTypeId: BIS3_INVOICE, processId })).not.toThrow();
    }
  });
});
