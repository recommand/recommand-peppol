import { describe, expect, it } from "bun:test";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import type { CreditNote } from "../utils/parsing/creditnote/schemas";
import { invoiceToUBL } from "../utils/parsing/invoice/peppol-ubl-bis3/to-xml";
import { creditNoteToUBL } from "../utils/parsing/creditnote/peppol-ubl-bis3/to-xml";
import { invoiceToCII } from "../utils/parsing/invoice/cii-d22b/to-xml";
import { creditNoteToCII } from "../utils/parsing/creditnote/cii-d22b/to-xml";
import { resolveBuyerReference } from "../utils/parsing/buyer-reference";
import { validateXml } from "./utils/utils";

// A German public authority is addressed by its Leitweg-ID (scheme 0204), and the
// same Leitweg-ID has to be in BT-10 Buyer reference (XRechnung BR-DE-15), or the
// federal invoice portal rejects the invoice. The writers fill it in from the
// recipient, refuse a different buyer reference, and never fall back to the invoice
// number for such a recipient. Every other recipient keeps the existing behaviour.

const LEITWEG_ID = "991-33333TEST-33";
const AUTHORITY = `0204:${LEITWEG_ID.toLowerCase()}`;
const SUPPLIER = "9930:de136695976";
const BUSINESS = "9930:de811569869";

const profile = {
  customizationId: "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
  processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
};
const ciiProfile = { customizationId: "urn:cen.eu:en16931:2017", processId: profile.processId };

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
  {
    name: "Beratung",
    quantity: "1",
    unitCode: "C62",
    netPriceAmount: "100.00",
    netAmount: null,
    vat: { category: "S" as const, percentage: "19.00" },
  },
];

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    invoiceNumber: "RE-2026-001",
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    currency: "EUR",
    seller,
    buyer,
    lines,
    paymentMeans: [{ paymentMethod: "credit_transfer", reference: "RE-2026-001", iban: "DE89370400440532013000" }],
    ...overrides,
  } as Invoice;
}

function creditNote(overrides: Partial<CreditNote> = {}): CreditNote {
  return {
    creditNoteNumber: "GS-2026-001",
    issueDate: "2026-10-02",
    currency: "EUR",
    invoiceReferences: [{ id: "RE-2026-001", issueDate: "2026-10-01" }],
    seller,
    buyer,
    lines,
    paymentMeans: [{ paymentMethod: "credit_transfer", reference: "GS-2026-001", iban: "DE89370400440532013000" }],
    ...overrides,
  } as CreditNote;
}

type Writer = (options: { document: any; recipientAddress: string }) => string;

const writers: { name: string; write: Writer; make: (overrides?: any) => any; buyerReference: RegExp }[] = [
  {
    name: "UBL invoice",
    write: ({ document, recipientAddress }) =>
      invoiceToUBL({ invoice: document, senderAddress: SUPPLIER, recipientAddress, isDocumentValidationEnforced: false, profile }),
    make: invoice,
    buyerReference: /<cbc:BuyerReference>([^<]*)<\/cbc:BuyerReference>/g,
  },
  {
    name: "UBL credit note",
    write: ({ document, recipientAddress }) =>
      creditNoteToUBL({ creditNote: document, senderAddress: SUPPLIER, recipientAddress, isDocumentValidationEnforced: false, profile }),
    make: creditNote,
    buyerReference: /<cbc:BuyerReference>([^<]*)<\/cbc:BuyerReference>/g,
  },
  {
    name: "CII invoice",
    write: ({ document, recipientAddress }) =>
      invoiceToCII({ invoice: document, senderAddress: SUPPLIER, recipientAddress, isDocumentValidationEnforced: false, profile: ciiProfile }),
    make: invoice,
    buyerReference: /<ram:BuyerReference>([^<]*)<\/ram:BuyerReference>/g,
  },
  {
    name: "CII credit note",
    write: ({ document, recipientAddress }) =>
      creditNoteToCII({ creditNote: document, senderAddress: SUPPLIER, recipientAddress, isDocumentValidationEnforced: false, profile: ciiProfile }),
    make: creditNote,
    buyerReference: /<ram:BuyerReference>([^<]*)<\/ram:BuyerReference>/g,
  },
];

function buyerReferences(xml: string, pattern: RegExp): string[] {
  return [...xml.matchAll(pattern)].map((match) => match[1]!);
}

describe("BT-10 for a recipient addressed by a Leitweg-ID", () => {
  for (const { name, write, make, buyerReference } of writers) {
    describe(name, () => {
      it("is filled in from the recipient when left out, even next to a purchase order reference", () => {
        expect(buyerReferences(write({ document: make(), recipientAddress: AUTHORITY }), buyerReference)).toEqual([LEITWEG_ID]);
        expect(
          buyerReferences(write({ document: make({ purchaseOrderReference: "PO-7" }), recipientAddress: AUTHORITY }), buyerReference)
        ).toEqual([LEITWEG_ID]);
      });

      it("keeps a buyer reference that is the Leitweg-ID", () => {
        expect(
          buyerReferences(write({ document: make({ buyerReference: ` ${LEITWEG_ID.toLowerCase()} ` }), recipientAddress: AUTHORITY }), buyerReference)
        ).toEqual([LEITWEG_ID.toLowerCase()]);
      });

      it("refuses a different buyer reference", () => {
        expect(() => write({ document: make({ buyerReference: "PO-7" }), recipientAddress: AUTHORITY })).toThrow(
          /requires its Leitweg-ID 991-33333TEST-33 as buyer reference \(BT-10\)/
        );
      });

      it("is unchanged for other recipients", () => {
        const number = name.includes("invoice") ? "RE-2026-001" : "GS-2026-001";
        expect(buyerReferences(write({ document: make(), recipientAddress: BUSINESS }), buyerReference)).toEqual([number]);
        expect(
          buyerReferences(write({ document: make({ purchaseOrderReference: "PO-7" }), recipientAddress: BUSINESS }), buyerReference)
        ).toEqual([]);
        expect(
          buyerReferences(write({ document: make({ buyerReference: "Abt. 4" }), recipientAddress: BUSINESS }), buyerReference)
        ).toEqual(["Abt. 4"]);
      });
    });
  }

  it("writes Peppol BIS documents to a Leitweg-ID that pass validation", async () => {
    await validateXml(writers[0]!.write({ document: invoice({ purchaseOrderReference: "PO-7", salesOrderReference: "SO-1" }), recipientAddress: AUTHORITY }), "UBL invoice to Leitweg-ID");
    await validateXml(writers[1]!.write({ document: creditNote(), recipientAddress: AUTHORITY }), "UBL credit note to Leitweg-ID");
  });

  it("writes BT-10 before the order reference, where the UBL schema puts it", async () => {
    const xml = writers[0]!.write({ document: invoice({ salesOrderReference: "SO-1" }), recipientAddress: BUSINESS });
    expect(xml.indexOf("<cbc:BuyerReference>")).toBeLessThan(xml.indexOf("<cac:OrderReference>"));
    await validateXml(xml, "UBL invoice with only a sales order reference");
  });

  it("resolves without a recipient as before", () => {
    expect(resolveBuyerReference({ documentNumber: "1", customerAddress: null })).toBe("1");
    expect(resolveBuyerReference({ documentNumber: "1", purchaseOrderReference: "PO", customerAddress: undefined })).toBeNull();
  });
});

describe("sending to a Leitweg-ID", () => {
  it("answers a conflicting buyer reference with a bad request before anything is written", async () => {
    const { prepareJsonDocument } = await import("../utils/pipelines/sending/prepare-json-document");
    const { SendingFailure } = await import("../utils/pipelines/sending/errors");
    const company = {
      id: "c_de", name: seller.name, address: seller.street, postalCode: seller.postalZone, city: seller.city, country: "DE",
      vatNumber: seller.vatNumber, enterpriseNumber: null, enterpriseNumberScheme: null, email: seller.email, phone: seller.phone,
      accessPointProvider: "recommand-ap1",
    } as any;
    const input = (buyerReference?: string) => ({
      documentType: "invoice",
      recipient: AUTHORITY,
      document: {
        invoiceNumber: "RE-2026-002",
        buyerReference,
        buyer,
        lines: [{ name: "Beratung", quantity: "1", unitCode: "C62", netPriceAmount: "100.00", vat: { category: "S", percentage: "19.00" } }],
        paymentMeans: [{ paymentMethod: "credit_transfer", reference: "RE-2026-002", iban: "DE89370400440532013000" }],
      },
    }) as any;

    const refused = prepareJsonDocument({ input: input("PO-7"), company, senderAddress: SUPPLIER, recipientAddress: AUTHORITY, documentId: "doc_1" });
    await expect(refused).rejects.toBeInstanceOf(SendingFailure);
    await expect(refused).rejects.toMatchObject({ status: 400 });

    const prepared = await prepareJsonDocument({ input: input(), company, senderAddress: SUPPLIER, recipientAddress: AUTHORITY, documentId: "doc_2" });
    expect(prepared.xml).toContain(`<cbc:BuyerReference>${LEITWEG_ID}</cbc:BuyerReference>`);
  });
});
