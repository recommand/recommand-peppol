import { describe, expect, it } from "bun:test";
import { invoiceSchema, type Invoice } from "../utils/parsing/invoice/schemas";
import { creditNoteSchema, type CreditNote } from "../utils/parsing/creditnote/schemas";
import { peppolUblBis3InvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-invoice";
import { peppolUblBis3CreditnoteFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-creditnote";
import { peppolUblSelfbillingInvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-selfbilling-invoice";
import { peppolUblSelfbillingCreditnoteFormat } from "../utils/type-repository/document-formats/peppol-ubl-selfbilling-creditnote";
import { ciiD22bEn16931Format } from "../utils/type-repository/document-formats/cii-d22b-en16931";
import type { AnyDocumentFormat } from "../utils/type-repository/document-formats/types";
import { validateXmlDocument } from "../data/validation/client";

// The billing period (BG-14) and the line billing period (BG-26) are carried by
// invoices, credit notes and their self-billing variants, in UBL as
// cac:InvoicePeriod and in CII as ram:BillingSpecifiedPeriod.

const context = {
  senderAddress: "0208:1234567894",
  recipientAddress: "0208:0123456749",
  isDocumentValidationEnforced: true,
};

const parties = {
  seller: { name: "Seller BV", street: "Street 1", street2: null, city: "Ghent", postalZone: "9000", country: "BE", vatNumber: "BE1234567894" },
  buyer: { name: "Buyer BV", street: "Street 2", street2: null, city: "Antwerp", postalZone: "2000", country: "BE", vatNumber: "BE0123456749" },
};

const lines = [
  {
    name: "Subscription March",
    quantity: "1",
    unitCode: "C62",
    netPriceAmount: "100.00",
    vat: { category: "S", percentage: "21.00" },
    billingPeriod: { startDate: "2026-03-01", endDate: "2026-03-31" },
  },
  {
    name: "Setup fee",
    quantity: "1",
    unitCode: "C62",
    netPriceAmount: "50.00",
    vat: { category: "S", percentage: "21.00" },
  },
];

const billingPeriod = { startDate: "2026-03-01", endDate: "2026-03-31" };

const invoice = (overrides: Record<string, unknown> = {}): Invoice =>
  invoiceSchema.parse({
    invoiceNumber: "INV-2026-001",
    issueDate: "2026-04-01",
    dueDate: "2026-05-01",
    ...parties,
    paymentMeans: [{ paymentMethod: "credit_transfer", reference: "INV-2026-001", iban: "BE68539007547034" }],
    lines,
    billingPeriod,
    ...overrides,
  });

const creditNote = (overrides: Record<string, unknown> = {}): CreditNote =>
  creditNoteSchema.parse({
    creditNoteNumber: "CN-2026-001",
    issueDate: "2026-04-01",
    invoiceReferences: [{ id: "INV-2026-001", issueDate: "2026-04-01" }],
    ...parties,
    lines,
    billingPeriod,
    ...overrides,
  });

const encode = (format: AnyDocumentFormat, document: Invoice | CreditNote) =>
  format.encode(document as any, format.supportedProcessIds[0], context);

const decode = (format: AnyDocumentFormat, xml: string) =>
  format.decode(xml, format.supportedProcessIds[0]) as Invoice | CreditNote;

const cases: { title: string; format: AnyDocumentFormat; document: () => Invoice | CreditNote }[] = [
  { title: "UBL invoice", format: peppolUblBis3InvoiceFormat, document: invoice },
  { title: "UBL credit note", format: peppolUblBis3CreditnoteFormat, document: creditNote },
  { title: "UBL self-billing invoice", format: peppolUblSelfbillingInvoiceFormat, document: invoice },
  { title: "UBL self-billing credit note", format: peppolUblSelfbillingCreditnoteFormat, document: creditNote },
  { title: "CII invoice", format: ciiD22bEn16931Format, document: invoice },
  { title: "CII credit note", format: ciiD22bEn16931Format, document: creditNote },
];

describe("billing period", () => {
  for (const { title, format, document } of cases) {
    it(`is written into a ${title}, read back and passes validation`, async () => {
      const xml = encode(format, document());
      const parsed = decode(format, xml);

      expect(parsed.billingPeriod).toEqual(billingPeriod);
      expect(parsed.lines[0].billingPeriod).toEqual(lines[0].billingPeriod);
      expect(parsed.lines[1].billingPeriod).toBeUndefined();

      const validation = await validateXmlDocument(xml, { profile: format.validationProfile });
      expect(validation.errors).toEqual([]);
      expect(validation.result).toBe("valid");
    });
  }

  it("is placed after the buyer reference and line amount in UBL", () => {
    const xml = encode(peppolUblBis3InvoiceFormat, invoice());
    expect(xml).toMatch(
      /<\/cbc:BuyerReference>\s*<cac:InvoicePeriod>\s*<cbc:StartDate>2026-03-01<\/cbc:StartDate>\s*<cbc:EndDate>2026-03-31<\/cbc:EndDate>\s*<\/cac:InvoicePeriod>/
    );
    expect(xml).toMatch(
      /<\/cbc:LineExtensionAmount>\s*<cac:InvoicePeriod>\s*<cbc:StartDate>2026-03-01<\/cbc:StartDate>\s*<cbc:EndDate>2026-03-31<\/cbc:EndDate>\s*<\/cac:InvoicePeriod>/
    );
  });

  it("is placed after the trade tax in CII", () => {
    const xml = encode(ciiD22bEn16931Format, invoice());
    expect(xml).toMatch(
      /<\/ram:ApplicableTradeTax>\s*<ram:BillingSpecifiedPeriod>\s*<ram:StartDateTime>\s*<udt:DateTimeString format="102">20260301<\/udt:DateTimeString>\s*<\/ram:StartDateTime>\s*<ram:EndDateTime>\s*<udt:DateTimeString format="102">20260331<\/udt:DateTimeString>/
    );
  });

  it("can be open-ended", async () => {
    for (const period of [{ startDate: "2026-03-01" }, { endDate: "2026-03-31" }]) {
      for (const format of [peppolUblBis3InvoiceFormat, ciiD22bEn16931Format]) {
        const xml = encode(format, invoice({ billingPeriod: period, lines: [lines[1]] }));
        expect(decode(format, xml).billingPeriod, format.key).toMatchObject(period);

        const validation = await validateXmlDocument(xml, { profile: format.validationProfile });
        expect(validation.errors, format.key).toEqual([]);
        expect(validation.result, format.key).toBe("valid");
      }
    }
  });

  it("can be given on a line without a document period", async () => {
    const withoutDocumentPeriod = cases.filter(({ title }) => !title.includes("self-billing"));
    for (const { title, format, document } of withoutDocumentPeriod) {
      const xml = encode(format, { ...document(), billingPeriod: undefined });
      const parsed = decode(format, xml);
      expect(parsed.billingPeriod, title).toBeUndefined();
      expect(parsed.lines[0].billingPeriod, title).toEqual(lines[0].billingPeriod);

      const validation = await validateXmlDocument(xml, { profile: format.validationProfile });
      expect(validation.errors, title).toEqual([]);
      expect(validation.result, title).toBe("valid");
    }
  });

  it("is left out when not given", () => {
    const document = invoice({ billingPeriod: undefined, lines: [lines[1]] });
    expect(encode(peppolUblBis3InvoiceFormat, document)).not.toContain("InvoicePeriod");
    const cii = encode(ciiD22bEn16931Format, document);
    expect(cii).not.toContain("BillingSpecifiedPeriod");
  });

  it("writes nothing for a period without dates that bypassed the schema", () => {
    const empty = { startDate: null, endDate: null };
    const withEmptyPeriods = <T extends Invoice | CreditNote>(document: T): T => ({
      ...document,
      billingPeriod: empty,
      lines: document.lines.map((line) => ({ ...line, billingPeriod: empty })),
    });
    expect(encode(peppolUblBis3InvoiceFormat, withEmptyPeriods(invoice()))).not.toContain("InvoicePeriod");
    expect(encode(peppolUblBis3CreditnoteFormat, withEmptyPeriods(creditNote()))).not.toContain("InvoicePeriod");
    expect(encode(ciiD22bEn16931Format, withEmptyPeriods(invoice()))).not.toContain("BillingSpecifiedPeriod");
  });

  it("refuses an empty period or one that ends before it starts", () => {
    expect(() => invoice({ billingPeriod: {} })).toThrow("needs a startDate or an endDate");
    expect(() => invoice({ billingPeriod: { startDate: "2026-03-31", endDate: "2026-03-01" } })).toThrow("must not be before its startDate");
    expect(() => invoice({ lines: [{ ...lines[0], billingPeriod: {} }] })).toThrow("needs a startDate or an endDate");
    expect(() => invoice({ lines: [{ ...lines[0], billingPeriod: { startDate: "2026-03-31", endDate: "2026-03-01" } }] })).toThrow("must not be before its startDate");
  });

  it("refuses a line period outside the document billing period when validation is enforced", () => {
    const outside = invoice({
      lines: [{ ...lines[0], billingPeriod: { startDate: "2026-02-15", endDate: "2026-03-31" } }],
    });
    expect(() => encode(peppolUblBis3InvoiceFormat, outside)).toThrow("starts before the billing period");
    const after = invoice({
      lines: [{ ...lines[0], billingPeriod: { startDate: "2026-03-01", endDate: "2026-04-15" } }],
    });
    expect(() => encode(ciiD22bEn16931Format, after)).toThrow("ends after the billing period");
    expect(() =>
      peppolUblBis3InvoiceFormat.encode(outside, peppolUblBis3InvoiceFormat.supportedProcessIds[0], {
        ...context,
        isDocumentValidationEnforced: false,
      })
    ).not.toThrow();
  });
});
