import { describe, expect, it } from "bun:test";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import type { CreditNote } from "../utils/parsing/creditnote/schemas";
import { invoiceToUBL } from "../utils/parsing/invoice/peppol-ubl-bis3/to-xml";
import { creditNoteToUBL } from "../utils/parsing/creditnote/peppol-ubl-bis3/to-xml";
import { invoiceToCII } from "../utils/parsing/invoice/cii-d22b/to-xml";
import { creditNoteToCII } from "../utils/parsing/creditnote/cii-d22b/to-xml";
import { resolveBuyerReference } from "../utils/parsing/buyer-reference";
import { validateXml } from "./utils/utils";

// A German public authority is addressed by its Leitweg-ID (scheme 0204), and a
// Leitweg-ID has to be in BT-10 Buyer reference (XRechnung BR-DE-15), or the federal
// invoice portal rejects the invoice. That is usually the one it is addressed by, but
// the authority may ask for another: the KoSIT guideline on Peppol identifiers in
// Germany (section 3.2.2) gives 0204:04000000-FHBXLAND-82 with 04000000-900X44X06-60
// in BT-10. The writers fill in the recipient's Leitweg-ID when BT-10 is left out,
// keep another Leitweg-ID, refuse anything else, and never fall back to the invoice
// number for such a recipient.
//
// Between a seller and a buyer both located in Germany, Peppol BIS (DE-R-015) and
// XRechnung (BR-DE-15) require BT-10 even next to an order reference, so the document
// number is filled in there. Every other recipient keeps the existing behaviour.

const LEITWEG_ID = "991-33333TEST-33";
const OTHER_LEITWEG_ID = "04000000-900X44X06-60";
const AUTHORITY = `0204:${LEITWEG_ID.toLowerCase()}`;
const SUPPLIER = "9930:de136695976";
const BUSINESS = "9930:de811569869";
const FOREIGN_BUSINESS = "9925:be0598726857";

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

      it("keeps a different Leitweg-ID the authority asked for", () => {
        expect(
          buyerReferences(write({ document: make({ buyerReference: OTHER_LEITWEG_ID }), recipientAddress: AUTHORITY }), buyerReference)
        ).toEqual([OTHER_LEITWEG_ID]);
      });

      it("refuses a buyer reference that is not a Leitweg-ID", () => {
        expect(() => write({ document: make({ buyerReference: "PO-7" }), recipientAddress: AUTHORITY })).toThrow(
          /requires a Leitweg-ID as buyer reference \(BT-10\). Got buyerReference 'PO-7', which is not a valid Leitweg-ID/
        );
        expect(() => write({ document: make({ buyerReference: "04000000-900X44X06-61" }), recipientAddress: AUTHORITY })).toThrow(
          /not a valid Leitweg-ID/
        );
      });

      it("is filled with the document number between a German seller and a German business buyer", () => {
        const number = name.includes("invoice") ? "RE-2026-001" : "GS-2026-001";
        const germanBuyer = { ...buyer, name: "Kunde GmbH", vatNumber: "DE811569869" };
        expect(buyerReferences(write({ document: make({ buyer: germanBuyer }), recipientAddress: BUSINESS }), buyerReference)).toEqual([number]);
        expect(
          buyerReferences(
            write({ document: make({ buyer: germanBuyer, purchaseOrderReference: "PO-7" }), recipientAddress: BUSINESS }),
            buyerReference
          )
        ).toEqual([number]);
        expect(
          buyerReferences(write({ document: make({ buyer: germanBuyer, buyerReference: "Abt. 4" }), recipientAddress: BUSINESS }), buyerReference)
        ).toEqual(["Abt. 4"]);
      });

      it("is unchanged for a buyer outside Germany", () => {
        const number = name.includes("invoice") ? "RE-2026-001" : "GS-2026-001";
        const foreignBuyer = { ...buyer, name: "Klant BV", city: "Brussel", postalZone: "1000", country: "BE", vatNumber: "BE0598726857" };
        expect(buyerReferences(write({ document: make({ buyer: foreignBuyer }), recipientAddress: FOREIGN_BUSINESS }), buyerReference)).toEqual([number]);
        expect(
          buyerReferences(
            write({ document: make({ buyer: foreignBuyer, purchaseOrderReference: "PO-7" }), recipientAddress: FOREIGN_BUSINESS }),
            buyerReference
          )
        ).toEqual([]);
        expect(
          buyerReferences(write({ document: make({ buyer: foreignBuyer, buyerReference: "Abt. 4" }), recipientAddress: FOREIGN_BUSINESS }), buyerReference)
        ).toEqual(["Abt. 4"]);
      });
    });
  }

  it("writes Peppol BIS documents to a Leitweg-ID that pass validation", async () => {
    await validateXml(writers[0]!.write({ document: invoice({ purchaseOrderReference: "PO-7", salesOrderReference: "SO-1" }), recipientAddress: AUTHORITY }), "UBL invoice to Leitweg-ID");
    await validateXml(writers[1]!.write({ document: creditNote(), recipientAddress: AUTHORITY }), "UBL credit note to Leitweg-ID");
    await validateXml(
      writers[0]!.write({ document: invoice({ buyerReference: OTHER_LEITWEG_ID }), recipientAddress: AUTHORITY }),
      "UBL invoice to Leitweg-ID with a different Leitweg-ID in BT-10"
    );
  });

  it("writes Peppol BIS documents between German businesses that pass DE-R-015 with only an order reference", async () => {
    const germanBuyer = { ...buyer, name: "Kunde GmbH", vatNumber: "DE811569869" };
    await validateXml(
      writers[0]!.write({ document: invoice({ buyer: germanBuyer, purchaseOrderReference: "PO-7" }), recipientAddress: BUSINESS }),
      "UBL invoice between German businesses"
    );
    await validateXml(
      writers[1]!.write({ document: creditNote({ buyer: germanBuyer, purchaseOrderReference: "PO-7" }), recipientAddress: BUSINESS }),
      "UBL credit note between German businesses"
    );
  });

  it("writes BT-10 before the order reference, where the UBL schema puts it", async () => {
    const xml = writers[0]!.write({ document: invoice({ salesOrderReference: "SO-1" }), recipientAddress: BUSINESS });
    expect(xml.indexOf("<cbc:BuyerReference>")).toBeLessThan(xml.indexOf("<cac:OrderReference>"));
    await validateXml(xml, "UBL invoice with only a sales order reference");
  });

  it("resolves without a recipient as before", () => {
    expect(resolveBuyerReference({ documentNumber: "1", customerAddress: null })).toBe("1");
    expect(resolveBuyerReference({ documentNumber: "1", purchaseOrderReference: "PO", customerAddress: undefined })).toBeNull();
    expect(
      resolveBuyerReference({ documentNumber: "1", purchaseOrderReference: "PO", customerAddress: null, sellerCountry: "DE", buyerCountry: "de" })
    ).toBe("1");
    expect(
      resolveBuyerReference({ documentNumber: "1", purchaseOrderReference: "PO", customerAddress: null, sellerCountry: "DE", buyerCountry: "AT" })
    ).toBeNull();
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

    const other = await prepareJsonDocument({ input: input(OTHER_LEITWEG_ID), company, senderAddress: SUPPLIER, recipientAddress: AUTHORITY, documentId: "doc_3" });
    expect(other.xml).toContain(`<cbc:BuyerReference>${OTHER_LEITWEG_ID}</cbc:BuyerReference>`);
  });
});
