import { describe, expect, it } from "bun:test";
import { invoiceSchema, sendInvoiceSchema, type Invoice } from "../utils/parsing/invoice/schemas";
import { creditNoteSchema, type CreditNote } from "../utils/parsing/creditnote/schemas";
import { peppolUblBis3InvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-invoice";
import { peppolUblBis3CreditnoteFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-creditnote";
import { peppolUblSelfbillingInvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-selfbilling-invoice";
import { peppolUblSelfbillingCreditnoteFormat } from "../utils/type-repository/document-formats/peppol-ubl-selfbilling-creditnote";
import { ciiD22bEn16931Format } from "../utils/type-repository/document-formats/cii-d22b-en16931";
import type { AnyDocumentFormat } from "../utils/type-repository/document-formats/types";
import { validateXmlDocument } from "../data/validation/client";

// The seller's tax registration identifier (BT-32), as Norway (NO-R-002) and
// Sweden (SE-R-005) use it to state the seller's registered status.

const context = {
  senderAddress: "0192:123456785",
  recipientAddress: "0208:0123456749",
  isDocumentValidationEnforced: true,
};

const norwegianSeller = {
  name: "Selger AS",
  street: "Storgata 1",
  city: "Oslo",
  postalZone: "0155",
  country: "NO",
  vatNumber: "NO123456785MVA",
  taxRegistrationId: "Foretaksregisteret",
};
const swedishSeller = {
  name: "Säljare AB",
  street: "Storgatan 1",
  city: "Stockholm",
  postalZone: "11122",
  country: "SE",
  vatNumber: "SE556677889901",
  enterpriseNumberScheme: "0007",
  enterpriseNumber: "5566778899",
  taxRegistrationId: "Godkänd för F-skatt",
};
const buyer = { name: "Buyer BV", street: "Street 2", city: "Antwerp", postalZone: "2000", country: "BE", vatNumber: "BE0123456749" };

const lines = [
  {
    name: "Consulting",
    quantity: "2",
    unitCode: "HUR",
    netPriceAmount: "100.00",
    vat: { category: "S", percentage: "25.00" },
  },
];

const invoice = (overrides: Record<string, unknown> = {}): Invoice =>
  invoiceSchema.parse({
    invoiceNumber: "INV-2026-001",
    issueDate: "2026-04-01",
    dueDate: "2026-05-01",
    seller: norwegianSeller,
    buyer,
    paymentMeans: [{ paymentMethod: "credit_transfer", reference: "INV-2026-001", iban: "NO9386011117947" }],
    lines,
    ...overrides,
  });

const creditNote = (overrides: Record<string, unknown> = {}): CreditNote =>
  creditNoteSchema.parse({
    creditNoteNumber: "CN-2026-001",
    issueDate: "2026-04-01",
    invoiceReferences: [{ id: "INV-2026-001", issueDate: "2026-04-01" }],
    seller: norwegianSeller,
    buyer,
    lines,
    ...overrides,
  });

const encode = (format: AnyDocumentFormat, document: Invoice | CreditNote) =>
  format.encode(document as any, format.supportedProcessIds[0], context);

const decode = (format: AnyDocumentFormat, xml: string) =>
  format.decode(xml, format.supportedProcessIds[0]) as Invoice | CreditNote;

const cases: { title: string; format: AnyDocumentFormat; document: (overrides?: Record<string, unknown>) => Invoice | CreditNote }[] = [
  { title: "UBL invoice", format: peppolUblBis3InvoiceFormat, document: invoice },
  { title: "UBL credit note", format: peppolUblBis3CreditnoteFormat, document: creditNote },
  { title: "UBL self-billing invoice", format: peppolUblSelfbillingInvoiceFormat, document: invoice },
  { title: "UBL self-billing credit note", format: peppolUblSelfbillingCreditnoteFormat, document: creditNote },
  { title: "CII invoice", format: ciiD22bEn16931Format, document: invoice },
  { title: "CII credit note", format: ciiD22bEn16931Format, document: creditNote },
];

describe("seller tax registration identifier", () => {
  for (const { title, format, document } of cases) {
    it(`is written into a ${title} next to the VAT number, read back and passes validation`, async () => {
      const xml = encode(format, document());
      const parsed = decode(format, xml);

      expect(parsed.seller.vatNumber).toBe("NO123456785MVA");
      expect(parsed.seller.taxRegistrationId).toBe("Foretaksregisteret");
      expect(parsed.buyer.vatNumber).toBe("BE0123456749");
      expect(parsed.buyer.taxRegistrationId).toBeUndefined();

      const validation = await validateXmlDocument(xml, { profile: format.validationProfile });
      expect(validation.errors).toEqual([]);
      expect(validation.result).toBe("valid");
    });
  }

  it("is where the Swedish F-tax rule looks for it", async () => {
    const swedish = (taxRegistrationId: string) =>
      encode(peppolUblBis3InvoiceFormat, invoice({
        seller: { ...swedishSeller, taxRegistrationId },
        paymentMeans: [{ paymentMethod: "credit_transfer", reference: "INV-2026-001", iban: "SE4550000000058398257466" }],
      }));

    const approved = await validateXmlDocument(swedish("Godkänd för F-skatt"));
    expect(approved.errors).toEqual([]);
    expect(approved.result).toBe("valid");

    const misstated = await validateXmlDocument(swedish("F-skatt"));
    expect(misstated.result).toBe("invalid");
    expect(misstated.errors.map((error) => error.ruleCode)).toContain("SE-R-005");
  });

  it("follows the VAT number in the UBL seller party", () => {
    const xml = encode(peppolUblBis3InvoiceFormat, invoice());
    expect(xml).toMatch(
      /<cac:PartyTaxScheme>\s*<cbc:CompanyID>NO123456785MVA<\/cbc:CompanyID>\s*<cac:TaxScheme>\s*<cbc:ID>VAT<\/cbc:ID>\s*<\/cac:TaxScheme>\s*<\/cac:PartyTaxScheme>\s*<cac:PartyTaxScheme>\s*<cbc:CompanyID>Foretaksregisteret<\/cbc:CompanyID>\s*<cac:TaxScheme>\s*<cbc:ID>TAX<\/cbc:ID>\s*<\/cac:TaxScheme>\s*<\/cac:PartyTaxScheme>\s*<cac:PartyLegalEntity>/
    );
  });

  it("follows the VAT number in the CII seller trade party", () => {
    const xml = encode(ciiD22bEn16931Format, invoice());
    expect(xml).toMatch(
      /<ram:SpecifiedTaxRegistration>\s*<ram:ID schemeID="VA">NO123456785MVA<\/ram:ID>\s*<\/ram:SpecifiedTaxRegistration>\s*<ram:SpecifiedTaxRegistration>\s*<ram:ID schemeID="FC">Foretaksregisteret<\/ram:ID>\s*<\/ram:SpecifiedTaxRegistration>\s*<\/ram:SellerTradeParty>/
    );
  });

  it("is written without a VAT number", () => {
    const seller = { ...norwegianSeller, vatNumber: null };
    for (const format of [peppolUblBis3InvoiceFormat, ciiD22bEn16931Format]) {
      const parsed = decode(format, encode(format, invoice({ seller })));
      expect(parsed.seller.vatNumber, format.key).toBeNull();
      expect(parsed.seller.taxRegistrationId, format.key).toBe("Foretaksregisteret");
    }
  });

  it("is left out when not given", () => {
    const seller = { ...norwegianSeller, taxRegistrationId: undefined };
    for (const [format, document] of [
      [peppolUblBis3InvoiceFormat, invoice({ seller })],
      [peppolUblBis3CreditnoteFormat, creditNote({ seller })],
      [ciiD22bEn16931Format, invoice({ seller })],
    ] as const) {
      const xml = encode(format, document);
      expect(xml, format.key).not.toContain("Foretaksregisteret");
      expect(xml, format.key).not.toContain(">TAX<");
      expect(xml, format.key).not.toContain('schemeID="FC"');
      const parsed = decode(format, xml);
      expect(parsed.seller.vatNumber, format.key).toBe("NO123456785MVA");
      expect("taxRegistrationId" in parsed.seller, format.key).toBe(false);
    }
  });

  it("is accepted on a document to send", () => {
    const parsed = sendInvoiceSchema.parse({
      invoiceNumber: "INV-2026-002",
      seller: norwegianSeller,
      buyer,
      lines,
    });
    expect(parsed.seller?.taxRegistrationId).toBe("Foretaksregisteret");
  });

  it("is refused on the buyer when validation is enforced", () => {
    const withBuyerTaxRegistration = invoice({ buyer: { ...buyer, taxRegistrationId: "Foretaksregisteret" } });
    expect(() => encode(peppolUblBis3InvoiceFormat, withBuyerTaxRegistration)).toThrow("Only the seller");
    expect(() => encode(ciiD22bEn16931Format, withBuyerTaxRegistration)).toThrow("Only the seller");
  });
});
