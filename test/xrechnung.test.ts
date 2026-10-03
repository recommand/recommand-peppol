import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { Company } from "@peppol/data/companies";
import type { RecipientCapabilities } from "../data/recipient-capabilities";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import type { CreditNote } from "../utils/parsing/creditnote/schemas";
import { COUNTRIES } from "../utils/countries";
import {
  detectDocumentFormat,
  getDocumentFormat,
  getDocumentFormatByDocTypeId,
} from "../utils/type-repository/document-formats";
import { invoiceDocumentType } from "../utils/type-repository/document-types/invoice";
import { creditNoteDocumentType } from "../utils/type-repository/document-types/creditNote";
import { prepareIncomingDocument } from "../utils/pipelines/receiving/prepare-document";
import { prepareXmlDocument } from "../utils/pipelines/sending/prepare-xml-document";
import { selectFormatAndProcess } from "../utils/pipelines/sending/select-format";
import { validateXml } from "./utils/utils";

// XRechnung 3.0 as formats of its own: written from JSON, detected in raw XML,
// parsed when received and offered to German companies by default. The validation
// tests need a validation service that runs the KoSIT XRechnung rules; point
// VALIDATION_SERVICE_URL at one and set XRECHNUNG_VALIDATION=1 to run them.

const PROCESS_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
const DOC_TYPE_IDS = {
  "xrechnung-ubl-invoice": `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${CUSTOMIZATION_ID}::2.1`,
  "xrechnung-ubl-creditnote": `urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##${CUSTOMIZATION_ID}::2.1`,
  "xrechnung-cii": `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##${CUSTOMIZATION_ID}::D16B`,
} as const;
const BIS3_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", "xrechnung-3.0.2", name)).text();
const VALIDATE = process.env.XRECHNUNG_VALIDATION === "1";

const SUPPLIER = "9930:de136695976";
const AUTHORITY = "0204:991-33333test-33";
const BUSINESS = "9930:de811569869";

const seller = {
  name: "Beispiel GmbH",
  street: "Musterstraße 1",
  street2: null,
  city: "Berlin",
  postalZone: "10115",
  country: "DE",
  vatNumber: "DE136695976",
  phone: "+49 30 1234567",
  email: "rechnung@beispiel.de",
};
const buyer = {
  name: "Bundesamt für Beispiele",
  street: "Amtsweg 2",
  street2: null,
  city: "Bonn",
  postalZone: "53113",
  country: "DE",
  vatNumber: null,
};
const lines = [
  { name: "Beratung", quantity: "2", unitCode: "HUR", netPriceAmount: "95.00", netAmount: null, vat: { category: "S" as const, percentage: "19.00" } },
  { name: "Reisekosten", quantity: "1", unitCode: "C62", netPriceAmount: "40.00", netAmount: null, vat: { category: "S" as const, percentage: "19.00" } },
];
const paymentMeans = [{ paymentMethod: "credit_transfer", reference: "RE-2026-001", iban: "DE89370400440532013000" }];

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  invoiceNumber: "RE-2026-001",
  issueDate: "2026-10-01",
  dueDate: "2026-10-31",
  currency: "EUR",
  seller,
  buyer,
  lines,
  paymentMeans,
  ...overrides,
}) as Invoice;

const creditNote = (overrides: Partial<CreditNote> = {}): CreditNote => ({
  creditNoteNumber: "GS-2026-001",
  issueDate: "2026-10-02",
  paymentTerms: { note: "Der Betrag wird Ihrem Konto gutgeschrieben" },
  currency: "EUR",
  invoiceReferences: [{ id: "RE-2026-001", issueDate: "2026-10-01" }],
  seller,
  buyer,
  lines,
  paymentMeans,
  ...overrides,
}) as CreditNote;

function encode(formatKey: keyof typeof DOC_TYPE_IDS, document: Invoice | CreditNote, recipientAddress = AUTHORITY): string {
  return getDocumentFormat(formatKey)!.encode(document as any, PROCESS_ID, {
    senderAddress: SUPPLIER,
    recipientAddress,
    isDocumentValidationEnforced: true,
  });
}

describe("XRechnung formats", () => {
  it("are registered under the Peppol document type identifiers for XRechnung 3.0", () => {
    for (const [key, docTypeId] of Object.entries(DOC_TYPE_IDS)) {
      const format = getDocumentFormat(key)!;
      expect(format.docTypeId).toBe(docTypeId);
      expect(format.supportedProcessIds).toEqual([PROCESS_ID]);
      expect(getDocumentFormatByDocTypeId(docTypeId)).toBe(format);
    }
  });

  it("are received by German companies by default, next to Peppol BIS", () => {
    const germany = COUNTRIES.find((country) => country.code === "DE")!;
    expect(germany.defaultDocumentTypes.map((capability) => capability.formatKey)).toEqual([
      "peppol-ubl-bis3-invoice",
      "peppol-ubl-bis3-creditnote",
      "xrechnung-ubl-invoice",
      "xrechnung-ubl-creditnote",
      "xrechnung-cii",
    ]);
    const belgium = COUNTRIES.find((country) => country.code === "BE")!;
    expect(belgium.defaultDocumentTypes.some((capability) => capability.formatKey.startsWith("xrechnung"))).toBe(false);
  });
});

describe("raw XRechnung XML", () => {
  it("is detected from its specification identifier", async () => {
    expect(detectDocumentFormat(await fixture("01.01a-INVOICE_ubl.xml"))?.key).toBe("xrechnung-ubl-invoice");
    expect(detectDocumentFormat(await fixture("ubl-cn-br-de-15-test.xml"))?.key).toBe("xrechnung-ubl-creditnote");
    expect(detectDocumentFormat(await fixture("01.01a-INVOICE_uncefact.xml"))?.key).toBe("xrechnung-cii");
  });

  it("does not take the extension for plain XRechnung or for another format", async () => {
    expect(detectDocumentFormat(await fixture("04.01a-INVOICE_ubl.xml"))).toBeUndefined();
  });

  it("is sent without routing overrides, for UBL and CII alike", async () => {
    const cases = [
      ["01.01a-INVOICE_ubl.xml", DOC_TYPE_IDS["xrechnung-ubl-invoice"], "invoice"],
      ["ubl-cn-br-de-15-test.xml", DOC_TYPE_IDS["xrechnung-ubl-creditnote"], "creditNote"],
      ["01.01a-INVOICE_uncefact.xml", DOC_TYPE_IDS["xrechnung-cii"], "invoice"],
    ] as const;
    for (const [name, docTypeId, type] of cases) {
      const prepared = prepareXmlDocument({ documentType: "xml", document: await fixture(name), recipient: AUTHORITY } as any);
      expect(prepared.docTypeId, name).toBe(docTypeId);
      expect(prepared.processId, name).toBe(PROCESS_ID);
      expect(prepared.type, name).toBe(type);
    }
  });
});

describe("receiving XRechnung", () => {
  const company = { name: "Empfänger GmbH" } as Company;
  const receive = async (name: string, docTypeId: string) =>
    prepareIncomingDocument({
      body: await fixture(name),
      contentType: "application/xml",
      docTypeId,
      processId: PROCESS_ID,
      company,
      senderId: "9930:de123456788",
    });

  it("parses a UBL invoice", async () => {
    const received = await receive("01.01a-INVOICE_ubl.xml", DOC_TYPE_IDS["xrechnung-ubl-invoice"]);
    expect(received.type).toBe("invoice");
    expect(received.parsedDocument).toMatchObject({ invoiceNumber: "123456XX", buyerReference: "04011000-12345-03" });
    expect(invoiceDocumentType.documentSchema.safeParse(received.parsedDocument).success).toBe(true);
  });

  it("parses a UBL credit note", async () => {
    const received = await receive("ubl-cn-br-de-15-test.xml", DOC_TYPE_IDS["xrechnung-ubl-creditnote"]);
    expect(received.type).toBe("creditNote");
    expect(creditNoteDocumentType.documentSchema.safeParse(received.parsedDocument).success).toBe(true);
  });

  it("parses a CII invoice", async () => {
    const received = await receive("01.01a-INVOICE_uncefact.xml", DOC_TYPE_IDS["xrechnung-cii"]);
    expect(received.type).toBe("invoice");
    expect(received.parsedDocument).toMatchObject({ invoiceNumber: "123456XX", buyerReference: "04011000-12345-03" });
    expect(invoiceDocumentType.documentSchema.safeParse(received.parsedDocument).success).toBe(true);
  });

  it("keeps an extension document unparsed rather than reading it as another format", async () => {
    const received = await receive("04.01a-INVOICE_ubl.xml", `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${CUSTOMIZATION_ID}#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0::2.1`);
    expect(received.type).toBe("unknown");
    expect(received.parsedDocument).toBeNull();
  });
});

describe("writing XRechnung", () => {
  it("names XRechnung as specification and fills BT-10 from a Leitweg-ID", () => {
    const ubl = encode("xrechnung-ubl-invoice", invoice());
    expect(ubl).toContain(`<cbc:CustomizationID>${CUSTOMIZATION_ID}</cbc:CustomizationID>`);
    expect(ubl).toContain("<cbc:BuyerReference>991-33333TEST-33</cbc:BuyerReference>");
    const cii = encode("xrechnung-cii", creditNote());
    expect(cii).toContain(`<ram:ID>${CUSTOMIZATION_ID}</ram:ID>`);
    expect(cii).toContain("<ram:TypeCode>381</ram:TypeCode>");
    expect(cii).toContain("<ram:BuyerReference>991-33333TEST-33</ram:BuyerReference>");
  });

  it("refuses a document without the fields XRechnung requires, naming all of them", () => {
    const incomplete = invoice({
      paymentMeans: [],
      purchaseOrderReference: "PO-7",
      seller: { ...seller, phone: null, email: null },
    });
    expect(() => encode("xrechnung-ubl-invoice", incomplete, BUSINESS)).toThrow(
      /buyerReference \(BT-10, BR-DE-15\).*paymentMeans \(BG-16, BR-DE-1\).*seller\.phone \(BT-42, BR-DE-6\).*seller\.email \(BT-43, BR-DE-7\)/
    );
    expect(() => encode("xrechnung-cii", incomplete, BUSINESS)).toThrow(/An XRechnung document requires/);
    expect(() => encode("xrechnung-cii", creditNote({ paymentTerms: null }))).toThrow(/paymentTerms \(BT-20, BR-CO-25\)/);
  });

  it("reads back what it writes", () => {
    for (const formatKey of ["xrechnung-ubl-invoice", "xrechnung-cii"] as const) {
      const format = getDocumentFormat(formatKey)!;
      const parsed = invoiceDocumentType.documentSchema.parse(format.decode(encode(formatKey, invoice()), PROCESS_ID));
      expect(parsed, formatKey).toMatchObject({ invoiceNumber: "RE-2026-001", buyerReference: "991-33333TEST-33" });
    }
    for (const formatKey of ["xrechnung-ubl-creditnote", "xrechnung-cii"] as const) {
      const format = getDocumentFormat(formatKey)!;
      const parsed = creditNoteDocumentType.documentSchema.parse(format.decode(encode(formatKey, creditNote()), PROCESS_ID));
      expect(parsed, formatKey).toMatchObject({ creditNoteNumber: "GS-2026-001" });
    }
  });

  describe.skipIf(!VALIDATE)("against the KoSIT XRechnung rules", () => {
    for (const [formatKey, make] of [
      ["xrechnung-ubl-invoice", () => invoice()],
      ["xrechnung-ubl-creditnote", () => creditNote()],
      ["xrechnung-cii", () => invoice()],
      ["xrechnung-cii", () => creditNote()],
    ] as const) {
      it(`writes a valid ${formatKey} ${make().hasOwnProperty("creditNoteNumber") ? "credit note" : "invoice"} to a public authority and to a business`, async () => {
        await validateXml(encode(formatKey, make()), `${formatKey} to Leitweg-ID`);
        await validateXml(encode(formatKey, { ...make(), buyerReference: "Abt. 4", buyer: { ...buyer, name: "Kunde GmbH", vatNumber: "DE811569869" } }, BUSINESS), `${formatKey} to business`);
      });
    }
  });
});

describe("routing a JSON invoice to a German recipient", () => {
  const registeredFor = (registrations: Record<string, string[]>): RecipientCapabilities => ({
    supportsDocType: (docTypeId) => docTypeId in registrations,
    getProcessIds: async (docTypeId) => registrations[docTypeId] ?? [],
  });
  const select = (capabilities: RecipientCapabilities, doctypeId?: string) =>
    selectFormatAndProcess({
      documentType: invoiceDocumentType,
      document: {},
      recipientAddress: AUTHORITY,
      doctypeId,
      company: { country: "DE", accessPointProvider: "recommand-ap1" },
      isPlayground: false,
      capabilities,
    });

  it("keeps Peppol BIS first when the recipient takes both", async () => {
    const selection = await select(registeredFor({ [BIS3_INVOICE]: [PROCESS_ID], [DOC_TYPE_IDS["xrechnung-ubl-invoice"]]: [PROCESS_ID] }));
    expect(selection.format.key).toBe("peppol-ubl-bis3-invoice");
  });

  it("writes XRechnung for a recipient that only takes XRechnung, UBL before CII", async () => {
    expect((await select(registeredFor({ [DOC_TYPE_IDS["xrechnung-ubl-invoice"]]: [PROCESS_ID], [DOC_TYPE_IDS["xrechnung-cii"]]: [PROCESS_ID] }))).format.key).toBe("xrechnung-ubl-invoice");
    expect((await select(registeredFor({ [DOC_TYPE_IDS["xrechnung-cii"]]: [PROCESS_ID] }))).format.key).toBe("xrechnung-cii");
  });

  it("writes XRechnung when the caller asks for it", async () => {
    const selection = await select(registeredFor({ [BIS3_INVOICE]: [PROCESS_ID] }), DOC_TYPE_IDS["xrechnung-ubl-invoice"]);
    expect(selection.format.key).toBe("xrechnung-ubl-invoice");
  });
});

describe("a recipient that only takes XRechnung", () => {
  const capabilities: RecipientCapabilities = {
    supportsDocType: (docTypeId) => docTypeId === DOC_TYPE_IDS["xrechnung-ubl-invoice"],
    getProcessIds: async () => [PROCESS_ID],
  };
  const company = {
    id: "c_de", name: seller.name, address: seller.street, postalCode: seller.postalZone, city: seller.city, country: "DE",
    vatNumber: seller.vatNumber, enterpriseNumber: null, enterpriseNumberScheme: null, email: null, phone: null,
    accessPointProvider: "recommand-ap1",
  } as any;
  const input = {
    documentType: "invoice",
    recipient: BUSINESS,
    document: {
      invoiceNumber: "RE-2026-003",
      buyer: { ...buyer, name: "Kunde GmbH" },
      lines: [{ name: "Beratung", quantity: "1", unitCode: "C62", netPriceAmount: "100.00", vat: { category: "S", percentage: "19.00" } }],
      paymentMeans,
    },
  } as any;

  it("gets XRechnung when the document has what XRechnung requires", async () => {
    const { prepareJsonDocument } = await import("../utils/pipelines/sending/prepare-json-document");
    const prepared = await prepareJsonDocument({
      input, company: { ...company, email: seller.email, phone: seller.phone }, senderAddress: SUPPLIER, recipientAddress: BUSINESS,
      documentId: "doc_x1", recipientCapabilities: capabilities,
    });
    expect(prepared.docTypeId).toBe(DOC_TYPE_IDS["xrechnung-ubl-invoice"]);
    expect(prepared.peppolRoutingFailure).toBeUndefined();
  });

  it("is skipped on Peppol, not refused, when the document misses XRechnung fields, so email delivery still applies", async () => {
    const { prepareJsonDocument } = await import("../utils/pipelines/sending/prepare-json-document");
    const prepared = await prepareJsonDocument({
      input, company, senderAddress: SUPPLIER, recipientAddress: BUSINESS, documentId: "doc_x2", recipientCapabilities: capabilities,
    });
    expect(prepared.docTypeId).toBe(BIS3_INVOICE);
    expect(prepared.peppolRoutingFailure).toMatch(/only receives invoice documents as XRechnung 3\.0 UBL Invoice.*seller\.phone/);
  });

  it("is refused when the caller asked for XRechnung itself", async () => {
    const { prepareJsonDocument } = await import("../utils/pipelines/sending/prepare-json-document");
    const { SendingFailure } = await import("../utils/pipelines/sending/errors");
    await expect(prepareJsonDocument({
      input: { ...input, doctypeId: DOC_TYPE_IDS["xrechnung-ubl-invoice"] }, company, senderAddress: SUPPLIER, recipientAddress: BUSINESS,
      documentId: "doc_x3", recipientCapabilities: capabilities,
    })).rejects.toBeInstanceOf(SendingFailure);
  });
});
