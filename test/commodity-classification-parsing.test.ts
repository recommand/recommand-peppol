import { describe, expect, it } from "bun:test";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import type { CreditNote } from "../utils/parsing/creditnote/schemas";
import { invoiceToUBL } from "../utils/parsing/invoice/peppol-ubl-bis3/to-xml";
import { invoiceToCII } from "../utils/parsing/invoice/cii-d22b/to-xml";
import { creditNoteToUBL } from "../utils/parsing/creditnote/peppol-ubl-bis3/to-xml";
import { parseInvoiceFromXML } from "../utils/parsing/invoice/peppol-ubl-bis3/from-xml";
import { parseInvoiceFromCII } from "../utils/parsing/invoice/cii-d22b/from-xml";
import { parseCreditNoteFromXML } from "../utils/parsing/creditnote/peppol-ubl-bis3/from-xml";

const profile = {
  customizationId: "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
  processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
};
const addresses = { senderAddress: "0208:1234567894", recipientAddress: "0208:0598726857" };

const invoice = {
  invoiceNumber: "CC-001",
  issueDate: "2026-01-01",
  dueDate: "2026-01-31",
  currency: "EUR",
  seller: { name: "Seller", street: "Seller Street 1", city: "Brussels", postalZone: "1000", country: "BE", vatNumber: "BE1234567894", street2: null },
  buyer: { name: "Buyer", street: "Buyer Street 1", city: "Antwerp", postalZone: "2000", country: "BE", vatNumber: "BE0598726857", street2: null },
  paymentMeans: [{ paymentMethod: "credit_transfer", reference: "CC-001", iban: "BE68539007547034" }],
  lines: [
    {
      name: "Service",
      quantity: "1",
      unitCode: "C62",
      netPriceAmount: "100.00",
      netAmount: null,
      vat: { category: "S", percentage: "21.00" },
      commodityClassifications: [
        { scheme: "STI", value: "123456" },
        { scheme: "CV", schemeVersion: "2008", value: "72000000" },
      ],
    },
  ],
} as Invoice;

const { invoiceNumber: _, ...rest } = invoice;
const creditNote = { ...rest, creditNoteNumber: "CC-CN-001" } as CreditNote;

const stiUbl = /<cac:CommodityClassification>\s*<cbc:ItemClassificationCode listID="STI">123456<\/cbc:ItemClassificationCode>\s*<\/cac:CommodityClassification>/;
const stiCii = /<ram:DesignatedProductClassification>\s*<ram:ClassCode listID="STI">123456<\/ram:ClassCode>\s*<\/ram:DesignatedProductClassification>/;

const toUBL = () => invoiceToUBL({ invoice, ...addresses, isDocumentValidationEnforced: false, profile });
const toCreditNoteUBL = () => creditNoteToUBL({ creditNote, ...addresses, isDocumentValidationEnforced: false, profile });
const toCII = () => invoiceToCII({ invoice, ...addresses, isDocumentValidationEnforced: false, profile });

const kept = [{ scheme: "CV", schemeVersion: "2008", value: "72000000" }];

// UBL 2.1 makes every child of cac:CommodityClassification optional: a sender can classify an
// item by cbc:NatureCode, cbc:CargoTypeCode or cbc:CommodityCode instead of
// cbc:ItemClassificationCode, and Peppol BIS Billing 3 only warns about those (UBL-CR-592 to
// UBL-CR-594). The parsed form keeps BT-158, so a classification without a usable BT-158
// (code and UNCL7143 scheme) is skipped instead of failing the whole document.
const unusableUbl: Record<string, string> = {
  "only a NatureCode": "<cac:CommodityClassification><cbc:NatureCode>X</cbc:NatureCode></cac:CommodityClassification>",
  "only a CommodityCode": "<cac:CommodityClassification><cbc:CommodityCode>X</cbc:CommodityCode></cac:CommodityClassification>",
  "no children": "<cac:CommodityClassification/>",
  "a code without a listID": "<cac:CommodityClassification><cbc:ItemClassificationCode>123456</cbc:ItemClassificationCode></cac:CommodityClassification>",
  "an empty code": '<cac:CommodityClassification><cbc:ItemClassificationCode listID="STI"/></cac:CommodityClassification>',
  "a listID outside UNCL7143": '<cac:CommodityClassification><cbc:ItemClassificationCode listID="XX">123456</cbc:ItemClassificationCode></cac:CommodityClassification>',
};

const unusableCii: Record<string, string> = {
  "no ClassCode": "<ram:DesignatedProductClassification><ram:ClassName>Services</ram:ClassName></ram:DesignatedProductClassification>",
  "a code without a listID": "<ram:DesignatedProductClassification><ram:ClassCode>123456</ram:ClassCode></ram:DesignatedProductClassification>",
  "a listID outside UNCL7143": '<ram:DesignatedProductClassification><ram:ClassCode listID="XX">123456</ram:ClassCode></ram:DesignatedProductClassification>',
};

describe("received commodity classifications without a usable item classification code", () => {
  it("writes the classification the tests replace", () => {
    expect(toUBL()).toMatch(stiUbl);
    expect(toCreditNoteUBL()).toMatch(stiUbl);
    expect(toCII()).toMatch(stiCii);
  });

  for (const [shape, replacement] of Object.entries(unusableUbl)) {
    it(`reads a UBL invoice whose classification has ${shape}, skipping it`, () => {
      const xml = toUBL().replace(stiUbl, replacement);
      expect(parseInvoiceFromXML(xml).lines[0].commodityClassifications).toEqual(kept);
    });

    it(`reads a UBL credit note whose classification has ${shape}, skipping it`, () => {
      const xml = toCreditNoteUBL().replace(stiUbl, replacement);
      expect(parseCreditNoteFromXML(xml).lines[0].commodityClassifications).toEqual(kept);
    });
  }

  for (const [shape, replacement] of Object.entries(unusableCii)) {
    it(`reads a CII invoice whose classification has ${shape}, skipping it`, () => {
      const xml = toCII().replace(stiCii, replacement);
      expect(parseInvoiceFromCII(xml).lines[0].commodityClassifications).toEqual(kept);
    });
  }

  it("still reads usable classifications", () => {
    const all = [{ scheme: "STI", value: "123456" }, ...kept];
    const withoutVersion = (list: any[] | null | undefined) =>
      list?.map(({ schemeVersion, ...c }) => (schemeVersion ? { ...c, schemeVersion } : c));
    expect(withoutVersion(parseInvoiceFromXML(toUBL()).lines[0].commodityClassifications)).toEqual(all);
    expect(withoutVersion(parseCreditNoteFromXML(toCreditNoteUBL()).lines[0].commodityClassifications)).toEqual(all);
    expect(withoutVersion(parseInvoiceFromCII(toCII()).lines[0].commodityClassifications)).toEqual(all);
  });
});
