import { describe, it, expect } from "bun:test";
import { selfBillingCreditNoteToUBL as serializeSelfBillingCreditNoteToUBL } from "../utils/parsing/self-billing-creditnote/to-xml";
import type { SelfBillingCreditNote } from "../utils/parsing/self-billing-creditnote/schemas";
import { parseSelfBillingCreditNoteFromXML } from "@peppol/utils/parsing/self-billing-creditnote/from-xml";
import { sendDocumentViaAPI, validateXml } from "./utils/utils";
import { XMLParser } from "fast-xml-parser";

const selfBillingProfile = {
  customizationId:
    "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0",
  processId: "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0",
};

function selfBillingCreditNoteToUBL(
  options: Omit<Parameters<typeof serializeSelfBillingCreditNoteToUBL>[0], "profile">,
) {
  return serializeSelfBillingCreditNoteToUBL({ ...options, profile: selfBillingProfile });
}

async function checkSelfBillingCreditNoteXML(xml: string, selfBillingCreditNote: SelfBillingCreditNote, testName: string = "self-billing credit note") {
  expect(xml).toBeDefined();
  expect(typeof xml).toBe("string");
  expect(xml.length).toBeGreaterThan(0);

  expect(xml).toContain('<CreditNote');
  expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');

  expect(xml).toContain(String(selfBillingCreditNote.creditNoteNumber));
  expect(xml).toContain(String(selfBillingCreditNote.issueDate));

  if (selfBillingCreditNote.currency) {
    expect(xml).toContain(String(selfBillingCreditNote.currency));
  }
  expect(xml).toContain(String(selfBillingCreditNote.seller.name));
  expect(xml).toContain(String(selfBillingCreditNote.buyer.name));

  await validateXml(xml, testName);
}

describe("selfBillingCreditNoteToUBL", () => {
  it("should convert self-billing credit note to XML", async () => {
    const selfBillingCreditNote: SelfBillingCreditNote = {
      creditNoteNumber: "SBCN-001",
      issueDate: "2025-10-29",
      currency: "EUR",
      note: "Self-billing credit note",
      buyerReference: "REFERENCE",
      purchaseOrderReference: "PurchaseOrderReference",
      invoiceReferences: [
        {
          id: "INV-001",
          issueDate: "2025-10-01",
        },
      ],
      seller: {
        name: "BEDRIJF",
        street: "STRAAT",
        city: "STAD",
        postalZone: "1234",
        country: "BE",
        vatNumber: "BE1234567894",
        street2: null,
      },
      buyer: {
        name: "KLANT",
        street: "STRAAT",
        city: "STAD",
        postalZone: "1234",
        country: "BE",
        vatNumber: "BE1234567894",
        street2: null,
      },
      lines: [
        {
          name: "Credit item",
          quantity: "1",
          unitCode: "C62",
          netPriceAmount: "100",
          netAmount: null,
          vat: {
            category: "S",
            percentage: "21.00",
          },
          buyersId: null,
          sellersId: "CREDIT",
          standardId: null,
          description: null,
          originCountry: null,
        },
      ],
      surcharges: [
        {
          reasonCode: "FC",
          reason: "Freight services",
          amount: "10.00",
          vat: {
            category: "S",
            percentage: "6.00",
          },
        },
      ],
      discounts: [
        {
          reasonCode: "95",
          reason: "Discount",
          amount: "10.00",
          vat: {
            category: "S",
            percentage: "6.00",
          },
        },
      ],
      paymentMeans: [
        {
          iban: "BE1234567890",
          reference: "REFERENCE",
          paymentMethod: "credit_transfer",
        },
      ],
      vat: null,
      delivery: null,
      totals: {
        paidAmount: "0.00",
        linesAmount: null,
        payableAmount: "121.00",
        discountAmount: null,
        surchargeAmount: null,
        taxExclusiveAmount: "100.00",
        taxInclusiveAmount: "121.00",
      },
    };

    const senderAddress = "0208:0428643097";
    const recipientAddress = "0208:0598726857";

    const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

    await checkSelfBillingCreditNoteXML(xml, selfBillingCreditNote, "self-billing credit note");

    const parsed = parseSelfBillingCreditNoteFromXML(xml);

    expect(parsed.creditNoteNumber).toBe(selfBillingCreditNote.creditNoteNumber);
    expect(parsed.issueDate).toBe(selfBillingCreditNote.issueDate);
    expect(parsed.currency).toBe(selfBillingCreditNote.currency);
    expect(parsed.seller.name).toBe(selfBillingCreditNote.seller.name);
    expect(parsed.buyer.name).toBe(selfBillingCreditNote.buyer.name);
    expect(parsed.lines.length).toBe(selfBillingCreditNote.lines.length);
    expect(parsed.totals?.discountAmount).toEqual("10.00");
    expect(parsed.totals?.surchargeAmount).toEqual("10.00");
    expect(parsed.totals?.taxExclusiveAmount).toEqual("100.00");
    expect(parsed.totals?.taxInclusiveAmount).toEqual("121.00");
    expect(parsed.totals?.payableAmount).toEqual("121.00");
    expect(parsed.vat?.totalVatAmount).toEqual("21.00");
    expect(parsed.vat?.subtotals.length).toBe(2);

    await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
  });

  function createBaseSelfBillingCreditNote(overrides: Partial<SelfBillingCreditNote>): SelfBillingCreditNote {
    return {
      creditNoteNumber: "TEST-SBCN-001",
      issueDate: "2025-01-01",
      currency: "EUR",
      seller: {
        name: "Test Seller",
        street: "Seller Street 1",
        city: "Seller City",
        postalZone: "1000",
        country: "BE",
        vatNumber: "BE1234567894",
        street2: null,
      },
      buyer: {
        name: "Test Buyer",
        street: "Buyer Street 1",
        city: "Buyer City",
        postalZone: "2000",
        country: "BE",
        vatNumber: "BE9876543210",
        street2: null,
      },
      lines: [],
      invoiceReferences: [],
      ...overrides,
    };
  }


  describe("line-level discounts and surcharges", () => {
    it("should preserve line discounts and surcharges in round-trip conversion", async () => {
      const selfBillingCreditNote = createBaseSelfBillingCreditNote({
        lines: [
          {
            name: "Item 1",
            quantity: "3.5",
            unitCode: "C62",
            netPriceAmount: "50.00",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            discounts: [
              { amount: "10.00", reason: "Early payment discount" },
              { amount: "5.00", reason: "Volume discount" },
            ],
            surcharges: [
              { amount: "8.50", reason: "Handling fee" },
            ],
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
          {
            name: "Item 2",
            quantity: "2",
            unitCode: "C62",
            netPriceAmount: "75.00",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            discounts: [
              { amount: "12.00", reasonCode: "95" },
            ],
            surcharges: [
              { amount: "5.00", reason: "Shipping" },
              { amount: "3.00", reasonCode: "FC" },
            ],
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

      await checkSelfBillingCreditNoteXML(xml, selfBillingCreditNote, "line-level discounts and surcharges");

      const parsed = parseSelfBillingCreditNoteFromXML(xml);

      expect(parsed.lines.length).toBe(2);

      const line1 = parsed.lines[0];
      expect(line1.name).toBe("Item 1");
      expect(parseFloat(line1.quantity)).toBe(3.5);
      expect(parseFloat(line1.netPriceAmount)).toBe(50);
      expect(line1.discounts?.length).toBe(2);
      expect(line1.discounts?.[0].amount).toBe("10.00");
      expect(line1.discounts?.[0].reason).toBe("Early payment discount");
      expect(line1.discounts?.[1].amount).toBe("5.00");
      expect(line1.discounts?.[1].reason).toBe("Volume discount");
      expect(line1.surcharges?.length).toBe(1);
      expect(line1.surcharges?.[0].amount).toBe("8.50");
      expect(line1.surcharges?.[0].reason).toBe("Handling fee");

      const line2 = parsed.lines[1];
      expect(line2.name).toBe("Item 2");
      expect(parseFloat(line2.quantity)).toBe(2);
      expect(parseFloat(line2.netPriceAmount)).toBe(75);
      expect(line2.discounts?.length).toBe(1);
      expect(line2.discounts?.[0].amount).toBe("12.00");
      expect(line2.discounts?.[0].reasonCode).toBe("95");
      expect(line2.surcharges?.length).toBe(2);
      expect(line2.surcharges?.[0].amount).toBe("5.00");
      expect(line2.surcharges?.[0].reason).toBe("Shipping");
      expect(line2.surcharges?.[1].amount).toBe("3.00");
      expect(line2.surcharges?.[1].reasonCode).toBe("FC");

      expect(line1.netAmount).toBeDefined();
      expect(line2.netAmount).toBeDefined();

      await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
    });

    it("should preserve line totals (netAmount) after round-trip conversion", async () => {
      const selfBillingCreditNote = createBaseSelfBillingCreditNote({
        lines: [
          {
            name: "Item 1",
            quantity: "2.5",
            unitCode: "C62",
            netPriceAmount: "80.00",
            netAmount: "190.00",
            vat: { category: "S", percentage: "21.00" },
            discounts: [
              { amount: "15.00", reason: "Discount" },
            ],
            surcharges: [
              { amount: "5.00", reason: "Surcharge" },
            ],
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

      await validateXml(xml, "line totals preservation");

      const parsed = parseSelfBillingCreditNoteFromXML(xml);

      expect(parsed.lines[0].netAmount).toBe("190.00");
      expect(parseFloat(parsed.lines[0].quantity)).toBe(2.5);
      expect(parseFloat(parsed.lines[0].netPriceAmount)).toBe(80);

      await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
    });
  });

  describe("global discounts and surcharges", () => {
    it("should preserve global discounts and surcharges in round-trip conversion", async () => {
      const selfBillingCreditNote = createBaseSelfBillingCreditNote({
        lines: [
          {
            name: "Item 1",
            quantity: "1",
            unitCode: "C62",
            netPriceAmount: "100.00",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
        discounts: [
          {
            reasonCode: "95",
            reason: "Early payment discount",
            amount: "10.00",
            vat: { category: "S", percentage: "21.00" },
          },
          {
            reason: "Volume discount",
            amount: "5.00",
            vat: { category: "S", percentage: "21.00" },
          },
        ],
        surcharges: [
          {
            reasonCode: "FC",
            reason: "Freight services",
            amount: "8.50",
            vat: { category: "S", percentage: "21.00" },
          },
          {
            reason: "Handling fee",
            amount: "3.00",
            vat: { category: "S", percentage: "6.00" },
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

      await validateXml(xml, "global discounts and surcharges");

      const parsed = parseSelfBillingCreditNoteFromXML(xml);

      expect(parsed.discounts?.length).toBe(2);
      expect(parsed.discounts?.[0].amount).toBe("10.00");
      expect(parsed.discounts?.[0].reasonCode).toBe("95");
      expect(parsed.discounts?.[0].reason).toBe("Early payment discount");
      expect(parsed.discounts?.[0].vat.category).toBe("S");
      expect(parsed.discounts?.[0].vat.percentage).toBe("21.00");
      expect(parsed.discounts?.[1].amount).toBe("5.00");
      expect(parsed.discounts?.[1].reason).toBe("Volume discount");
      expect(parsed.discounts?.[1].vat.category).toBe("S");
      expect(parsed.discounts?.[1].vat.percentage).toBe("21.00");

      expect(parsed.surcharges?.length).toBe(2);
      expect(parsed.surcharges?.[0].amount).toBe("8.50");
      expect(parsed.surcharges?.[0].reasonCode).toBe("FC");
      expect(parsed.surcharges?.[0].reason).toBe("Freight services");
      expect(parsed.surcharges?.[0].vat.category).toBe("S");
      expect(parsed.surcharges?.[0].vat.percentage).toBe("21.00");
      expect(parsed.surcharges?.[1].amount).toBe("3.00");
      expect(parsed.surcharges?.[1].reason).toBe("Handling fee");
      expect(parsed.surcharges?.[1].vat.category).toBe("S");
      expect(parsed.surcharges?.[1].vat.percentage).toBe("6.00");

      await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
    });
  });

  describe("combined line-level and global discounts/surcharges", () => {
    it("should preserve both line-level and global discounts/surcharges in round-trip conversion", async () => {
      const selfBillingCreditNote = createBaseSelfBillingCreditNote({
        lines: [
          {
            name: "Item 1",
            quantity: "3",
            unitCode: "C62",
            netPriceAmount: "50.00",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            discounts: [
              { amount: "10.00", reason: "Line discount 1" },
              { amount: "5.00", reason: "Line discount 2" },
            ],
            surcharges: [
              { amount: "8.50", reason: "Line surcharge" },
            ],
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
          {
            name: "Item 2",
            quantity: "2",
            unitCode: "C62",
            netPriceAmount: "75.00",
            netAmount: null,
            vat: { category: "S", percentage: "6.00" },
            discounts: [
              { amount: "12.00", reasonCode: "95" },
            ],
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
        discounts: [
          {
            reason: "Global discount",
            amount: "15.00",
            vat: { category: "S", percentage: "21.00" },
          },
        ],
        surcharges: [
          {
            reasonCode: "FC",
            reason: "Global freight",
            amount: "10.00",
            vat: { category: "S", percentage: "21.00" },
          },
          {
            reason: "Global handling",
            amount: "5.00",
            vat: { category: "S", percentage: "6.00" },
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

      await validateXml(xml, "combined line-level and global discounts/surcharges");

      const parsed = parseSelfBillingCreditNoteFromXML(xml);

      expect(parsed.lines.length).toBe(2);

      const line1 = parsed.lines[0];
      expect(line1.discounts?.length).toBe(2);
      expect(line1.discounts?.[0].amount).toBe("10.00");
      expect(line1.discounts?.[1].amount).toBe("5.00");
      expect(line1.surcharges?.length).toBe(1);
      expect(line1.surcharges?.[0].amount).toBe("8.50");

      const line2 = parsed.lines[1];
      expect(line2.discounts?.length).toBe(1);
      expect(line2.discounts?.[0].amount).toBe("12.00");
      expect(line2.surcharges?.length).toBe(0);

      expect(parsed.discounts?.length).toBe(1);
      expect(parsed.discounts?.[0].amount).toBe("15.00");
      expect(parsed.discounts?.[0].reason).toBe("Global discount");

      expect(parsed.surcharges?.length).toBe(2);
      expect(parsed.surcharges?.[0].amount).toBe("10.00");
      expect(parsed.surcharges?.[0].reasonCode).toBe("FC");
      expect(parsed.surcharges?.[1].amount).toBe("5.00");
      expect(parsed.surcharges?.[1].reason).toBe("Global handling");

      await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
    });
  });

  describe("document totals preservation", () => {
    it("should preserve all document totals in round-trip conversion with line and global discounts/surcharges", async () => {
      const selfBillingCreditNote = createBaseSelfBillingCreditNote({
        lines: [
          {
            name: "Item 1",
            quantity: "2.5",
            unitCode: "C62",
            netPriceAmount: "80.00",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            discounts: [
              { amount: "15.00", reason: "Line discount" },
            ],
            surcharges: [
              { amount: "5.00", reason: "Line surcharge" },
            ],
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
          {
            name: "Item 2",
            quantity: "3",
            unitCode: "C62",
            netPriceAmount: "50.00",
            netAmount: null,
            vat: { category: "S", percentage: "6.00" },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
        discounts: [
          {
            reason: "Global discount",
            amount: "10.00",
            vat: { category: "S", percentage: "21.00" },
          },
        ],
        surcharges: [
          {
            reason: "Global surcharge",
            amount: "8.00",
            vat: { category: "S", percentage: "6.00" },
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

      await validateXml(xml, "document totals preservation with line and global discounts/surcharges");

      const parsed = parseSelfBillingCreditNoteFromXML(xml);

      expect(parsed.totals).toBeDefined();
      expect(parsed.totals?.linesAmount).toBeDefined();
      expect(parsed.totals?.taxExclusiveAmount).toBeDefined();
      expect(parsed.totals?.taxInclusiveAmount).toBeDefined();
      expect(parsed.totals?.discountAmount).toBeDefined();
      expect(parsed.totals?.surchargeAmount).toBeDefined();
      expect(parsed.totals?.payableAmount).toBeDefined();

      expect(parsed.vat).toBeDefined();
      expect(parsed.vat?.totalVatAmount).toBeDefined();
      expect(parsed.vat?.subtotals).toBeDefined();
      expect(parsed.vat?.subtotals.length).toBeGreaterThan(0);

      const taxExclusive = parseFloat(parsed.totals!.taxExclusiveAmount);
      const totalVat = parseFloat(parsed.vat!.totalVatAmount);
      const taxInclusive = parseFloat(parsed.totals!.taxInclusiveAmount);
      expect(taxInclusive).toBeCloseTo(taxExclusive + totalVat, 2);

      await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
    });
  });

  describe("address swapping", () => {
    it("should swap addresses for self-billing credit note (sender = customer, recipient = supplier)", async () => {
      const selfBillingCreditNote = createBaseSelfBillingCreditNote({
        lines: [
          {
            name: "Item 1",
            quantity: "1",
            unitCode: "C62",
            netPriceAmount: "100.00",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

      await validateXml(xml, "address swapping");

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: true,
        parseAttributeValue: false,
        parseTagValue: false,
      });
      const parsed = parser.parse(xml);

      const supplierEndpointId = parsed.CreditNote.AccountingSupplierParty.Party.EndpointID;
      const customerEndpointId = parsed.CreditNote.AccountingCustomerParty.Party.EndpointID;

      expect(`${supplierEndpointId["@_schemeID"]}:${supplierEndpointId["#text"]}`).toBe(recipientAddress);
      expect(`${customerEndpointId["@_schemeID"]}:${customerEndpointId["#text"]}`).toBe(senderAddress);

      const parsedCreditNote = parseSelfBillingCreditNoteFromXML(xml);
      expect(parsedCreditNote.seller.name).toBe(selfBillingCreditNote.seller.name);
      expect(parsedCreditNote.buyer.name).toBe(selfBillingCreditNote.buyer.name);

      await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
    });
  });

  describe("enterprise number", () => {
    it("should include enterprise number in seller and buyer when provided", async () => {
      const selfBillingCreditNote = createBaseSelfBillingCreditNote({
        seller: {
          name: "Test Seller",
          street: "Seller Street 1",
          city: "Seller City",
          postalZone: "1000",
          country: "BE",
          vatNumber: "BE1234567894",
          enterpriseNumber: "1234567894",
          street2: null,
        },
        buyer: {
          name: "Test Buyer",
          street: "Buyer Street 1",
          city: "Buyer City",
          postalZone: "2000",
          country: "BE",
          vatNumber: "BE9876543210",
          enterpriseNumber: "9876543210",
          street2: null,
        },
        lines: [
          {
            name: "Item 1",
            quantity: "1",
            unitCode: "C62",
            netPriceAmount: "100.00",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

      await validateXml(xml, "enterprise number");

      expect(xml).toContain('<cbc:CompanyID>1234567894</cbc:CompanyID>');
      expect(xml).toContain('<cbc:CompanyID>9876543210</cbc:CompanyID>');

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: true,
        parseAttributeValue: false,
        parseTagValue: false,
      });
      const parsed = parser.parse(xml);
      const supplierEnterpriseNumber = parsed.CreditNote.AccountingSupplierParty.Party.PartyLegalEntity.CompanyID;
      const customerEnterpriseNumber = parsed.CreditNote.AccountingCustomerParty.Party.PartyLegalEntity.CompanyID;

      expect(supplierEnterpriseNumber).toBe("1234567894");
      expect(customerEnterpriseNumber).toBe("9876543210");

      const parsedCreditNote = parseSelfBillingCreditNoteFromXML(xml);
      expect(parsedCreditNote.seller.name).toBe(selfBillingCreditNote.seller.name);
      expect(parsedCreditNote.buyer.name).toBe(selfBillingCreditNote.buyer.name);

      await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
    });

    it("should handle missing enterprise number", async () => {
      const selfBillingCreditNote = createBaseSelfBillingCreditNote({
        seller: {
          name: "Test Seller",
          street: "Seller Street 1",
          city: "Seller City",
          postalZone: "1000",
          country: "BE",
          vatNumber: "BE1234567894",
          enterpriseNumber: null,
          street2: null,
        },
        buyer: {
          name: "Test Buyer",
          street: "Buyer Street 1",
          city: "Buyer City",
          postalZone: "2000",
          country: "BE",
          vatNumber: "BE9876543210",
          enterpriseNumber: null,
          street2: null,
        },
        lines: [
          {
            name: "Item 1",
            quantity: "1",
            unitCode: "C62",
            netPriceAmount: "100.00",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

      await validateXml(xml, "missing enterprise number");

      await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
    });
  });

  describe("VAT category O (Not subject to VAT)", () => {
    it("should handle self-billing credit note with VAT category O and exemption reason", async () => {
      const selfBillingCreditNote = createBaseSelfBillingCreditNote({
        seller: {
          name: "Test Seller",
          street: "Seller Street 1",
          city: "Seller City",
          postalZone: "1000",
          country: "BE",
          vatNumber: null,
          enterpriseNumber: "1234567894",
          street2: null,
        },
        buyer: {
          name: "Test Buyer",
          street: "Buyer Street 1",
          city: "Buyer City",
          postalZone: "2000",
          country: "BE",
          vatNumber: null,
          enterpriseNumber: "9876543210",
          street2: null,
        },
        lines: [
          {
            name: "Item not subject to VAT",
            quantity: "1",
            unitCode: "C62",
            netPriceAmount: "100.00",
            netAmount: null,
            vat: {
              category: "O",
              percentage: "0.00",
            },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
        vat: {
          exemptionReason: "Not subject to VAT according to local legislation",
        } as any,
        totals: {
          paidAmount: "0.00",
          linesAmount: null,
          payableAmount: "100.00",
          discountAmount: null,
          surchargeAmount: null,
          taxExclusiveAmount: "100.00",
          taxInclusiveAmount: "100.00",
        },
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const xml = selfBillingCreditNoteToUBL({ selfBillingCreditNote, senderAddress, recipientAddress, isDocumentValidationEnforced: false });

      await validateXml(xml, "VAT category O with exemption reason");

      expect(xml).toContain('cbc:ID>O</cbc:ID>');
      expect(xml).toContain("Not subject to VAT according to local legislation");
      expect(xml).toContain('<cbc:CompanyID>1234567894</cbc:CompanyID>');

      const parsed = parseSelfBillingCreditNoteFromXML(xml);
      expect(parsed.lines[0].vat.category).toBe("O");
      expect(parsed.lines[0].vat.percentage).toBe("0.00");
      expect(parsed.vat?.subtotals.length).toBe(1);
      expect(parsed.vat?.subtotals[0].category).toBe("O");
      expect(parsed.vat?.subtotals[0].vatAmount).toBe("0.00");
      expect(parsed.vat?.subtotals[0].exemptionReason).toBe("Not subject to VAT according to local legislation");
      expect(parsed.totals?.taxExclusiveAmount).toBe("100.00");
      expect(parsed.totals?.taxInclusiveAmount).toBe("100.00");
      expect(parsed.totals?.payableAmount).toBe("100.00");

      await sendDocumentViaAPI(selfBillingCreditNote, "selfBillingCreditNote", recipientAddress);
    });
  });
});
