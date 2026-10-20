/**
 * A doc type id the caller sets for raw XML goes into the envelope as it is, and the
 * recipient routes and validates the document by it. One the document itself plainly
 * contradicts is refused; everything else is sent as before.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { SendingFailure } from "../utils/pipelines/sending/errors";
import { prepareJsonDocument } from "../utils/pipelines/sending/prepare-json-document";
import { prepareXmlDocument } from "../utils/pipelines/sending/prepare-xml-document";
import { sendDocumentSchema } from "../utils/parsing/send-document";

const BILLING_PROCESS_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const FRANCE_REGULATED_PROCESS_ID = "urn:peppol:france:billing:regulated";

const BIS3 = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const XRECHNUNG = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
const PLAIN_EN16931 = "urn:cen.eu:en16931:2017";
const PEPPOL_FRANCE_CIUS = "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0";
const OFFICIAL_FRANCE_EXTENDED = "urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr";
const PEPPOL_FRANCE_EXTENDED = "urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0";

const UBL_INVOICE_ROOT = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice";
const UBL_CREDIT_NOTE_ROOT = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote";
const CII_ROOT = "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice";
const CDAR_DOC_TYPE_ID =
  "urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100::CrossDomainAcknowledgementAndResponse##urn:peppol:france:billing:cdv:1.0::D22B";

const ublInvoiceDocType = (customizationId: string) => `${UBL_INVOICE_ROOT}##${customizationId}::2.1`;
const ublCreditNoteDocType = (customizationId: string) => `${UBL_CREDIT_NOTE_ROOT}##${customizationId}::2.1`;
const ciiDocType = (customizationId: string, version = "D22B") => `${CII_ROOT}##${customizationId}::${version}`;

function ublInvoice(customizationId?: string, root = "Invoice"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  ${customizationId ? `<cbc:CustomizationID>${customizationId}</cbc:CustomizationID>` : ""}
  <cbc:ProfileID>${BILLING_PROCESS_ID}</cbc:ProfileID>
  <cbc:ID>CONSISTENCY-1</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
</${root}>`;
}

const ublCreditNote = (customizationId?: string) => ublInvoice(customizationId, "CreditNote");

function ciiInvoice(guidelineId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${guidelineId}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
</rsm:CrossIndustryInvoice>`;
}

function cdar(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossDomainAcknowledgementAndResponse xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn.cpro.gouv.fr:1p0:CDV:invoice</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
</rsm:CrossDomainAcknowledgementAndResponse>`;
}

function prepare(document: string, extra: Record<string, unknown> = {}) {
  return prepareXmlDocument(
    sendDocumentSchema.parse({
      recipient: "0208:0795374462",
      documentType: "xml",
      document,
      processId: BILLING_PROCESS_ID,
      ...extra,
    })
  );
}

function refusal(document: string, extra: Record<string, unknown>): SendingFailure {
  try {
    prepare(document, extra);
  } catch (error) {
    if (error instanceof SendingFailure) return error;
    throw error;
  }
  throw new Error("expected the send to be refused");
}

const xrechnungFixture = (name: string) =>
  Bun.file(join(import.meta.dir, "fixtures", "xrechnung-3.0.2", name)).text();

describe("a doctypeId the XML contradicts", () => {
  it("is refused when it names an invoice for a credit note", () => {
    const error = refusal(ublCreditNote(BIS3), { doctypeId: ublInvoiceDocType(BIS3) });

    expect(error.status).toBe(400);
    expect(error.message).toContain("The doctypeId does not match the XML document");
    expect(error.message).toContain(
      "names root element Invoice in namespace urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    );
    expect(error.message).toContain(
      "the document's root element is CreditNote in namespace urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
    );
    // What the caller can do: leave it out, which gives the right one.
    expect(error.message).toContain(
      `Leave doctypeId out to have it derived from the document (which gives ${ublCreditNoteDocType(BIS3)})`
    );
  });

  it("is refused when it names Peppol BIS for an XRechnung", async () => {
    const document = await xrechnungFixture("01.01a-INVOICE_ubl.xml");
    const error = refusal(document, { doctypeId: ublInvoiceDocType(BIS3) });

    expect(error.status).toBe(400);
    expect(error.message).toContain(`the doctypeId names customization ${BIS3}, but the document declares ${XRECHNUNG}`);
    expect(error.message).toContain(`which gives ${ublInvoiceDocType(XRECHNUNG)}`);
    expect(error.message).not.toContain("root element");
  });

  it("is refused when it names UBL for a CII document", async () => {
    const document = await xrechnungFixture("01.01a-INVOICE_uncefact.xml");
    const error = refusal(document, { doctypeId: ublInvoiceDocType(XRECHNUNG) });

    expect(error.message).toContain("the document's root element is CrossIndustryInvoice");
    expect(error.message).toContain("urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100");
  });

  it("is refused when it names the French CIUS for a Peppol BIS document", () => {
    const error = refusal(ublInvoice(BIS3), {
      doctypeId: ublInvoiceDocType(PEPPOL_FRANCE_CIUS),
      processId: FRANCE_REGULATED_PROCESS_ID,
    });

    expect(error.message).toContain(`but the document declares ${BIS3}`);
  });

  it("is refused with the scheme in front of it", () => {
    expect(() =>
      prepare(ublCreditNote(BIS3), { doctypeId: `busdox-docid-qns::${ublInvoiceDocType(BIS3)}` })
    ).toThrow(SendingFailure);
  });

  it("says so for every part that differs", () => {
    const error = refusal(ublCreditNote(XRECHNUNG), { doctypeId: ublInvoiceDocType(BIS3) });

    expect(error.message).toContain("root element is CreditNote");
    expect(error.message).toContain(`but the document declares ${XRECHNUNG}`);
  });
});

describe("a doctypeId the XML agrees with", () => {
  it("is sent as given", async () => {
    for (const [document, doctypeId] of [
      [ublInvoice(BIS3), ublInvoiceDocType(BIS3)],
      [ublCreditNote(BIS3), ublCreditNoteDocType(BIS3)],
      [await xrechnungFixture("01.01a-INVOICE_ubl.xml"), ublInvoiceDocType(XRECHNUNG)],
      [await xrechnungFixture("01.01a-INVOICE_uncefact.xml"), ciiDocType(XRECHNUNG, "D16B")],
    ] as const) {
      expect(prepare(document, { doctypeId }).docTypeId).toBe(doctypeId);
    }
  });

  it("is not compared on its version, its case, whitespace or the scheme in front of it", () => {
    for (const doctypeId of [
      `${UBL_INVOICE_ROOT}##${BIS3}::2.2`,
      `${UBL_INVOICE_ROOT}##${BIS3}`,
      ublInvoiceDocType(BIS3).toUpperCase(),
      ` ${ublInvoiceDocType(BIS3)} `,
      `busdox-docid-qns::${ublInvoiceDocType(BIS3)}`,
      `peppol-doctype-wildcard::${ublInvoiceDocType(BIS3)}`,
    ]) {
      // Passed through as the caller wrote it, exactly as before.
      expect(prepare(ublInvoice(BIS3), { doctypeId }).docTypeId).toBe(doctypeId);
    }
    expect(
      prepare(ublInvoice(` ${BIS3.toUpperCase()} `), { doctypeId: ublInvoiceDocType(BIS3) }).docTypeId
    ).toBe(ublInvoiceDocType(BIS3));
  });

  it("is accepted for a document whose root element carries a prefix", async () => {
    // The fixture's root is <ubl:Invoice>.
    const document = await xrechnungFixture("04.01a-INVOICE_ubl.xml");
    expect(prepare(document, { doctypeId: ublInvoiceDocType(XRECHNUNG) }).docTypeId).toBe(
      ublInvoiceDocType(XRECHNUNG)
    );
  });

  it("is accepted when one customization extends the other", () => {
    const extension = `${XRECHNUNG}#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0`;
    expect(prepare(ublInvoice(extension), { doctypeId: ublInvoiceDocType(XRECHNUNG) }).docTypeId).toBe(
      ublInvoiceDocType(XRECHNUNG)
    );
    // Plain EN 16931 is what every CIUS of it builds on.
    expect(prepare(ciiInvoice(PLAIN_EN16931), { doctypeId: ciiDocType(BIS3, "D16B") }).docTypeId).toBe(
      ciiDocType(BIS3, "D16B")
    );
  });

  it("is accepted for the French documents, whose customization differs from the doc type id by design", () => {
    const french = { processId: FRANCE_REGULATED_PROCESS_ID };
    for (const [document, doctypeId] of [
      [ublInvoice(PLAIN_EN16931), ublInvoiceDocType(PEPPOL_FRANCE_CIUS)],
      [ublCreditNote(PLAIN_EN16931), ublCreditNoteDocType(PEPPOL_FRANCE_CIUS)],
      [ciiInvoice(PLAIN_EN16931), ciiDocType(PEPPOL_FRANCE_CIUS)],
      [ublInvoice(OFFICIAL_FRANCE_EXTENDED), ublInvoiceDocType(PEPPOL_FRANCE_EXTENDED)],
      [ublCreditNote(OFFICIAL_FRANCE_EXTENDED), ublCreditNoteDocType(PEPPOL_FRANCE_EXTENDED)],
      [ciiInvoice(OFFICIAL_FRANCE_EXTENDED), ciiDocType(PEPPOL_FRANCE_EXTENDED)],
      [cdar(), CDAR_DOC_TYPE_ID],
    ] as const) {
      expect(prepare(document, { ...french, doctypeId }).docTypeId).toBe(doctypeId);
    }
    // Also without the process, which the platform resolves afterwards.
    expect(prepare(ciiInvoice(PLAIN_EN16931), { processId: undefined, doctypeId: ciiDocType(PEPPOL_FRANCE_CIUS) }).docTypeId).toBe(
      ciiDocType(PEPPOL_FRANCE_CIUS)
    );
  });

  it("is accepted for a CDAR inside a Standard Business Document", () => {
    const enveloped = `<?xml version="1.0" encoding="UTF-8"?>
<StandardBusinessDocument xmlns="http://www.unece.org/cefact/namespaces/StandardBusinessDocumentHeader">
  ${cdar().replace(/<\?xml[^>]*\?>/, "")}
</StandardBusinessDocument>`;
    expect(prepare(enveloped, { doctypeId: CDAR_DOC_TYPE_ID, processId: FRANCE_REGULATED_PROCESS_ID }).docTypeId).toBe(
      CDAR_DOC_TYPE_ID
    );
  });
});

describe("a doctypeId that cannot be compared", () => {
  it("is sent as given when the document's customization is one no format knows", () => {
    // XRechnung 2.3: the document says what it is, but nothing here can tell whether
    // another doc type id stands for the same specification.
    const document = ublInvoice("urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_2.3");
    expect(prepare(document, { doctypeId: ublInvoiceDocType(BIS3) }).docTypeId).toBe(ublInvoiceDocType(BIS3));
  });

  it("is sent as given when the document declares no customization", () => {
    expect(prepare(ublInvoice(), { doctypeId: ublInvoiceDocType(XRECHNUNG) }).docTypeId).toBe(
      ublInvoiceDocType(XRECHNUNG)
    );
  });

  it("is sent as given when the document binds no namespace to its root", () => {
    const document = `<Invoice><CustomizationID>${BIS3}</CustomizationID></Invoice>`;
    expect(prepare(document, { doctypeId: ublInvoiceDocType(BIS3) }).docTypeId).toBe(ublInvoiceDocType(BIS3));
  });

  it("is sent as given when it is not in the Peppol layout", () => {
    for (const doctypeId of [
      "urn:some:doctype:nobody:knows::1.0",
      "urn:peppol:doctype:pdf+xml##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:Factur-X:1.0::D22B",
      `some-other-scheme::${ublInvoiceDocType(BIS3)}`,
    ]) {
      expect(prepare(ublCreditNote(XRECHNUNG), { doctypeId }).docTypeId).toBe(doctypeId);
    }
  });

  it("is sent as given when the document is not XML", () => {
    expect(prepare("this is not an xml document", { doctypeId: ublInvoiceDocType(BIS3) }).docTypeId).toBe(
      ublInvoiceDocType(BIS3)
    );
  });
});

describe("a JSON document", () => {
  it("is sent under the doctypeId it asks for, as before", async () => {
    const input = sendDocumentSchema.parse({
      documentType: "invoice",
      recipient: "0208:0795374462",
      doctypeId: ublInvoiceDocType(BIS3),
      processId: BILLING_PROCESS_ID,
      document: {
        invoiceNumber: "INV-1",
        buyer: { name: "Buyer BV", street: "Straat 1", city: "Gent", postalZone: "9000", country: "BE", vatNumber: "BE0795374462" },
        lines: [{ name: "Consulting", quantity: "1", unitCode: "C62", netPriceAmount: "100.00", vat: { category: "S", percentage: "21.00" } }],
      },
    });
    const company = {
      id: "c_be", name: "Seller BV", address: "Straat 2", postalCode: "2000", city: "Antwerpen", country: "BE",
      vatNumber: "BE1234567894", enterpriseNumber: "1234567894", enterpriseNumberScheme: "0208", email: null, phone: null,
      accessPointProvider: "recommand-ap1",
    } as any;

    const prepared = await prepareJsonDocument({
      input,
      company,
      senderAddress: "0208:1234567894",
      recipientAddress: "0208:0795374462",
      documentId: "doc_json",
    });

    expect(prepared.docTypeId).toBe(ublInvoiceDocType(BIS3));
    expect(prepared.processId).toBe(BILLING_PROCESS_ID);
    expect(prepared.xml).toContain(`<cbc:CustomizationID>${BIS3}</cbc:CustomizationID>`);
  });
});
