import { describe, it, expect } from "bun:test";
import { invoiceToUBL } from "../utils/parsing/invoice/peppol-ubl-bis3/to-xml";
import { invoiceToCII } from "../utils/parsing/invoice/cii-d22b/to-xml";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import { parseInvoiceFromXML } from "@peppol/utils/parsing/invoice/peppol-ubl-bis3/from-xml";
import { parseInvoiceFromCII } from "@peppol/utils/parsing/invoice/cii-d22b/from-xml";
import { sendDocumentViaAPI, validateXml } from "./utils/utils";
import { XMLParser } from "fast-xml-parser";
import Decimal from "decimal.js";
import {
  CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
} from "@peppol/utils/document-types";
import { resolveOutgoingDocumentXmlHandler } from "@peppol/utils/outgoing-document-payload";

function asFrenchRegulatedInvoice(invoice: Invoice): Invoice {
  // EN16931 category O requires seller and buyer VAT identifiers to be omitted.
  const hasOutsideScopeVat = [
    ...invoice.lines,
    ...(invoice.discounts ?? []),
    ...(invoice.surcharges ?? []),
  ].some((item) => item.vat?.category === "O");

  return {
    ...invoice,
    currency: "EUR",
    seller: {
      ...invoice.seller,
      country: "FR",
      vatNumber: hasOutsideScopeVat ? undefined : "FR40303265045",
      enterpriseNumber: "303265045",
      enterpriseNumberScheme: "0002",
    },
    buyer: {
      ...invoice.buyer,
      vatNumber: hasOutsideScopeVat ? undefined : invoice.buyer.vatNumber,
    },
    countrySpecific: {
      country: "FR",
      billingMode: "B1",
      recoveryCostsNote: "Indemnité forfaitaire de 40 EUR pour frais de recouvrement.",
      latePaymentPenaltiesNote: "Pénalités de retard selon les conditions de paiement.",
      earlyPaymentDiscountNote: "Aucun escompte accordé pour paiement anticipé.",
    },
  };
}

function expectDecimalEqual(actual: string | null | undefined, expected: string) {
  expect(new Decimal(actual ?? "0").equals(expected)).toBe(true);
}

function withDefaultCiiDelivery<T extends { buyer: Invoice["buyer"]; delivery?: Invoice["delivery"] }>(
  document: T
): T {
  if (document.delivery) {
    return document;
  }

  return {
    ...document,
    delivery: {
      date: null,
      locationIdentifier: undefined,
      location: {
        street: document.buyer.street,
        street2: document.buyer.street2 || null,
        city: document.buyer.city,
        postalZone: document.buyer.postalZone,
        country: document.buyer.country,
      },
      recipientName: document.buyer.name,
    },
  };
}

function checkUBLInvoiceXML(xml: string, invoice: Invoice) {
  expect(xml).toBeDefined();
  expect(typeof xml).toBe("string");
  expect(xml.length).toBeGreaterThan(0);
  
  expect(xml).toContain('<Invoice');
  expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');

  expect(xml).toContain(String(invoice.invoiceNumber));
  expect(xml).toContain(String(invoice.issueDate));
  
  if (invoice.dueDate) {
    expect(xml).toContain(String(invoice.dueDate));
  }
  
  if (invoice.currency) {
    expect(xml).toContain(String(invoice.currency));
  }
  expect(xml).toContain(String(invoice.seller.name));
  expect(xml).toContain(String(invoice.buyer.name));
}

function checkCIIInvoiceXML(xml: string, invoice: Invoice) {
  expect(xml).toBeDefined();
  expect(typeof xml).toBe("string");
  expect(xml.length).toBeGreaterThan(0);

  expect(xml).toContain("<CrossIndustryInvoice");
  expect(xml).toContain(
    'xmlns="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"'
  );

  expect(xml).toContain(String(invoice.invoiceNumber));
  expect(xml).toContain(String(invoice.issueDate).replaceAll("-", ""));

  if (invoice.dueDate) {
    expect(xml).toContain(String(invoice.dueDate).replaceAll("-", ""));
  }

  if (invoice.currency) {
    expect(xml).toContain(String(invoice.currency));
  }
  expect(xml).toContain(String(invoice.seller.name));
  expect(xml).toContain(String(invoice.buyer.name));
}

async function checkInvoiceXML({
  invoice,
  senderAddress,
  recipientAddress,
  testName = "invoice",
  isDocumentValidationEnforced = false,
}: {
  invoice: Invoice;
  senderAddress: string;
  recipientAddress: string;
  testName?: string;
  isDocumentValidationEnforced?: boolean;
}) {
  const ublXml = invoiceToUBL({
    invoice,
    senderAddress,
    recipientAddress,
    isDocumentValidationEnforced,
  });
  const ciiXml = invoiceToCII({
    invoice,
    senderAddress,
    recipientAddress,
    isDocumentValidationEnforced,
  });
  const frenchInvoice = asFrenchRegulatedInvoice(invoice);
  const facturXResolution = resolveOutgoingDocumentXmlHandler(
    FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    "invoice"
  );
  if (!facturXResolution.ok) {
    throw new Error(facturXResolution.message);
  }
  const frenchCiiResolution = resolveOutgoingDocumentXmlHandler(
    CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    "invoice"
  );
  if (!frenchCiiResolution.ok) {
    throw new Error(frenchCiiResolution.message);
  }
  const frenchCiiXml = frenchCiiResolution.resolution.handler.toXml({
    document: frenchInvoice,
    senderAddress: "0225:303265045",
    recipientAddress,
    isDocumentValidationEnforced,
  });
  const facturXXml = facturXResolution.resolution.handler.toXml({
    document: frenchInvoice,
    senderAddress: "0225:303265045",
    recipientAddress,
    isDocumentValidationEnforced,
  });
  checkUBLInvoiceXML(ublXml, invoice);
  checkCIIInvoiceXML(ciiXml, invoice);
  checkCIIInvoiceXML(frenchCiiXml, frenchInvoice);
  checkCIIInvoiceXML(facturXXml, frenchInvoice);
  expect(facturXXml).toContain("<ram:SubjectCode>PMT</ram:SubjectCode>");
  expect(facturXXml).toContain("<ram:SubjectCode>PMD</ram:SubjectCode>");
  expect(facturXXml).toContain("<ram:SubjectCode>AAB</ram:SubjectCode>");

  await Promise.all([
    validateXml(ublXml, `${testName} UBL`),
    validateXml(ciiXml, `${testName} CII D22B`),
    validateXml(frenchCiiXml, `${testName} French CII D22B`),
    validateXml(facturXXml, `${testName} Factur-X CII D22B`),
  ]);

  const parsedUbl = parseInvoiceFromXML(ublXml);
  const parsedCii = parseInvoiceFromCII(ciiXml);
  const parsedFrenchCii = parseInvoiceFromCII(frenchCiiXml);
  const parsedFacturX = parseInvoiceFromCII(facturXXml);
  const normalizedFrenchInvoice = parseInvoiceFromXML(
    invoiceToUBL({
      invoice: frenchInvoice,
      senderAddress: "0225:303265045",
      recipientAddress,
      isDocumentValidationEnforced,
    })
  );
  const expectedCii = withDefaultCiiDelivery(parsedUbl);
  const expectedFacturX = withDefaultCiiDelivery(normalizedFrenchInvoice);

  expect(parsedCii).toEqual(expectedCii);
  expect(parsedFrenchCii).toEqual(expectedFacturX);
  expect(parsedFacturX).toEqual(expectedFacturX);
  expect(parsedFacturX).toEqual(parsedFrenchCii);

  return { ublXml, ciiXml, frenchCiiXml, facturXXml, parsedInvoice: parsedUbl };
}


describe("invoice XML generation", () => {
  it("should convert Factuur 25607246 invoice to XML", async () => {
    const invoice: Invoice = {
      invoiceNumber: "1234",
      issueDate: "2025-10-29",
      dueDate: "2025-11-28",
      currency: "EUR",
      note: "Note",
      buyerReference: "REFERENCE",
      purchaseOrderReference: "PurchaseOrderReference",
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
          name: "hst",
          quantity: "1",
          unitCode: "C62",
          netPriceAmount: "100",
          netAmount: null,
          vat: {
            category: "S",
            percentage: "21.00",
          },
          buyersId: null,
          sellersId: "HST",
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

    const { parsedInvoice: parsed } = await checkInvoiceXML({
      invoice,
      senderAddress,
      recipientAddress,
      testName: "Factuur 25607246 invoice",
    });

    expect(parsed.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(parsed.issueDate).toBe(invoice.issueDate);
    expect(parsed.dueDate).toBe(invoice.dueDate);
    expect(parsed.currency).toBe(invoice.currency);
    expect(parsed.seller.name).toBe(invoice.seller.name);
    expect(parsed.buyer.name).toBe(invoice.buyer.name);
    expect(parsed.lines.length).toBe(invoice.lines.length);
    expect(parsed.totals?.discountAmount).toEqual("10.00");
    expect(parsed.totals?.surchargeAmount).toEqual("10.00");
    expect(parsed.totals?.taxExclusiveAmount).toEqual("100.00");
    expect(parsed.totals?.taxInclusiveAmount).toEqual("121.00");
    expect(parsed.totals?.payableAmount).toEqual("121.00");
    expect(parsed.vat?.totalVatAmount).toEqual("21.00");
    expect(parsed.vat?.subtotals.length).toBe(2);

    await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
  });

  function createBaseInvoice(overrides: Partial<Invoice>): Invoice {
    return {
      invoiceNumber: "TEST-001",
      issueDate: "2025-01-01",
      dueDate: "2025-02-01",
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
      ...overrides,
    };
  }

  describe("complex invoice payload", () => {
    it("should round-trip a complex invoice with references, delivery, negative line and item metadata", async () => {
      const invoice = createBaseInvoice({
        invoiceNumber: "INV-TEST-001",
        buyerReference: "PO123",
        purchaseOrderReference: "PO1234",
        salesOrderReference: "SO1234",
        currency: "CAD",
        issueDate: "2025-06-30",
        dueDate: "2025-07-30",
        buyer: {
          vatNumber: "BE0771287976",
          enterpriseNumber: "1234",
          name: "Kobe Indemans",
          street: "Nieuwdorp 5",
          street2: "",
          city: "Peer",
          postalZone: "3990",
          country: "BE",
          email: "kobe@example.com",
          phone: "0123456",
        },
        despatchReference: "DE-123",
        delivery: {
          date: "2025-10-21",
          locationIdentifier: {
            scheme: "0208",
            identifier: "0659689080",
          },
          location: {
            street: "straat 1",
            city: "Peer",
            postalZone: "3990",
            country: "BE",
          },
          recipientName: "Company Ltd.",
        },
        paymentMeans: [
          {
            name: "Belfius",
            paymentMethod: "other",
            reference: "INV-TEST-001",
            iban: "BE92731060018723",
            financialInstitutionBranch: "KREDBEB",
          },
        ],
        paymentTerms: {
          note: "Net 30",
        },
        lines: [
          {
            id: "a1",
            name: "Test",
            description: "Test",
            buyersId: "BID-001",
            sellersId: "CS-001",
            standardId: {
              scheme: "0160",
              identifier: "10986700",
            },
            originCountry: "BE",
            quantity: "-1.00",
            unitCode: "HUR",
            netPriceAmount: "1.00",
            netAmount: "-1.00",
            vat: {
              category: "S",
              percentage: "21.00",
            },
            orderLineReference: "ORDER_LINE_REF_01",
            documentReference: "ORIGINAL-INVOICE-01",
            commodityClassifications: [
              {
                scheme: "SN",
                schemeVersion: "1",
                value: "123456",
              },
              {
                scheme: "SN",
                value: "1234567",
              },
            ],
            additionalItemProperties: [
              {
                name: "Color",
                value: "Green",
              },
              {
                name: "Size",
                value: "XL",
              },
            ],
          },
          {
            name: "Test",
            note: "Here's your discount!",
            description: "Test",
            buyersId: "BID-001",
            sellersId: "CS-001",
            standardId: {
              scheme: "0160",
              identifier: "10986700",
            },
            originCountry: "BE",
            quantity: "20.00",
            unitCode: "HUR",
            netPriceAmount: "1.00",
            netAmount: "22.00",
            vat: {
              category: "S",
              percentage: "21.00",
            },
            discounts: [
              {
                amount: "1.00",
                reasonCode: "95",
              },
            ],
            surcharges: [
              {
                amount: "3.00",
                reason: "TEST",
              },
            ],
          },
          {
            name: "Test",
            quantity: "1.00",
            unitCode: "C62",
            netPriceAmount: "0.00",
            netAmount: "0.00",
            vat: {
              category: "E",
              percentage: "0.00",
            },
          },
        ],
        vat: {
          exemptionReason: "Test",
        } as any,
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "complex invoice payload",
      });

      expect(parsed.invoiceNumber).toBe("INV-TEST-001");
      expect(parsed.currency).toBe("CAD");
      expect(parsed.buyer.name).toBe("Kobe Indemans");
      expect(parsed.purchaseOrderReference).toBe("PO1234");
      expect(parsed.salesOrderReference).toBe("SO1234");
      expect(parsed.despatchReference).toBe("DE-123");
      expect(parsed.delivery?.recipientName).toBe("Company Ltd.");
      expect(parsed.paymentMeans?.[0].paymentMethod).toBe("other");
      expect(parsed.lines.length).toBe(3);
      expectDecimalEqual(parsed.lines[0].quantity, "-1.00");
      expectDecimalEqual(parsed.lines[0].netAmount, "-1.00");
      expect(parsed.lines[0].commodityClassifications?.length).toBe(2);
      expect(parsed.lines[0].additionalItemProperties?.length).toBe(2);
      expect(parsed.lines[1].note).toBe("Here's your discount!");
      expect(parsed.lines[1].discounts?.[0].reasonCode).toBe("95");
      expect(parsed.lines[1].surcharges?.[0].reason).toBe("TEST");
      expect(parsed.lines[2].vat.category).toBe("E");
      expect(parsed.vat?.subtotals.some((subtotal) => subtotal.exemptionReason === "Test")).toBe(true);
    });
  });


  describe("line-level discounts and surcharges", () => {
    it("should preserve line discounts and surcharges in round-trip conversion", async () => {
      const invoice = createBaseInvoice({
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
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "line-level discounts and surcharges",
      });

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

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });

    it("should preserve line totals (netAmount) after round-trip conversion", async () => {
      const invoice = createBaseInvoice({
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
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "line totals preservation",
      });

      expect(parsed.lines[0].netAmount).toBe("190.00");
      expect(parseFloat(parsed.lines[0].quantity)).toBe(2.5);
      expect(parseFloat(parsed.lines[0].netPriceAmount)).toBe(80);

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });

  describe("global discounts and surcharges", () => {
    it("should preserve global discounts and surcharges in round-trip conversion", async () => {
      const invoice = createBaseInvoice({
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
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "global discounts and surcharges",
      });

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

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });

  describe("combined line-level and global discounts/surcharges", () => {
    it("should preserve both line-level and global discounts/surcharges in round-trip conversion", async () => {
      const invoice = createBaseInvoice({
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
            baseQuantity: "1",
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
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "combined line-level and global discounts/surcharges",
      });

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

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });

  describe("document totals preservation", () => {
    it("should preserve all document totals in round-trip conversion with line and global discounts/surcharges", async () => {
      const invoice = createBaseInvoice({
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
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "document totals preservation with line and global discounts/surcharges",
      });

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

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });

    it("should preserve totals with different VAT rates on discounts and surcharges", async () => {
      const invoice = createBaseInvoice({
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
            reason: "Discount 21%",
            amount: "10.00",
            vat: { category: "S", percentage: "21.00" },
          },
          {
            reason: "Discount 6%",
            amount: "5.00",
            vat: { category: "S", percentage: "6.00" },
          },
        ],
        surcharges: [
          {
            reason: "Surcharge 21%",
            amount: "8.00",
            vat: { category: "S", percentage: "21.00" },
          },
          {
            reason: "Surcharge 6%",
            amount: "3.00",
            vat: { category: "S", percentage: "6.00" },
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "totals with different VAT rates on discounts and surcharges",
      });

      expect(parsed.totals?.discountAmount).toBeDefined();
      expect(parsed.totals?.surchargeAmount).toBeDefined();
      expect(parsed.vat?.subtotals.length).toBeGreaterThanOrEqual(2);

      const vat21Subtotal = parsed.vat?.subtotals.find(s => s.percentage === "21.00");
      const vat6Subtotal = parsed.vat?.subtotals.find(s => s.percentage === "6.00");

      expect(vat21Subtotal).toBeDefined();
      expect(vat6Subtotal).toBeDefined();

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });

  describe("rounding scenarios with discounts and surcharges", () => {
    it("should preserve line and global discounts/surcharges with high precision values", async () => {
      const invoice = createBaseInvoice({
        lines: [
          {
            name: "Item 1",
            quantity: "1.333",
            unitCode: "C62",
            netPriceAmount: "7.499",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            discounts: [
              { amount: "1.11", reason: "Precision discount 1" },
              { amount: "0.89", reason: "Precision discount 2" },
            ],
            surcharges: [
              { amount: "0.78", reason: "Precision surcharge" },
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
            reason: "Global precision discount",
            amount: "2.22",
            vat: { category: "S", percentage: "21.00" },
          },
        ],
        surcharges: [
          {
            reason: "Global precision surcharge",
            amount: "1.33",
            vat: { category: "S", percentage: "21.00" },
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "rounding scenarios with discounts and surcharges",
      });

      expect(parsed.lines[0].discounts?.length).toBe(2);
      expect(parsed.lines[0].quantity).toBe("1.333");
      expect(parsed.lines[0].discounts?.[0].amount).toBe("1.11");
      expect(parsed.lines[0].discounts?.[1].amount).toBe("0.89");
      expect(parsed.lines[0].surcharges?.[0].amount).toBe("0.78");

      expect(parsed.discounts?.[0].amount).toBe("2.22");
      expect(parsed.surcharges?.[0].amount).toBe("1.33");

      expect(parsed.totals?.taxExclusiveAmount).toBeDefined();
      expect(parsed.totals?.taxInclusiveAmount).toBeDefined();
      expect(parsed.vat?.totalVatAmount).toBeDefined();

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });

  describe("edge cases", () => {
    it("should handle invoice with only line discounts (no surcharges)", async () => {
      const invoice = createBaseInvoice({
        lines: [
          {
            name: "Item 1",
            quantity: "2",
            unitCode: "C62",
            netPriceAmount: "50.00",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            discounts: [
              { amount: "10.00", reason: "Discount" },
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
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "invoice with only line discounts",
      });

      expect(parsed.lines[0].discounts?.length).toBe(1);
      expect(parsed.lines[0].discounts?.[0].amount).toBe("10.00");
      expect(parsed.lines[0].surcharges?.length).toBe(0);

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });

    it("should handle invoice with only line surcharges (no discounts)", async () => {
      const invoice = createBaseInvoice({
        lines: [
          {
            name: "Item 1",
            quantity: "2",
            unitCode: "C62",
            netPriceAmount: "50.00",
            baseQuantity: "1",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
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
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "invoice with only line surcharges",
      });

      expect(parsed.lines[0].surcharges?.length).toBe(1);
      expect(parsed.lines[0].surcharges?.[0].amount).toBe("5.00");
      expect(parsed.lines[0].discounts?.length).toBe(0);

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });

    it("should handle invoice with reasonCode only (no reason text)", async () => {
      const invoice = createBaseInvoice({
        lines: [
          {
            name: "Item 1",
            quantity: "1",
            unitCode: "C62",
            netPriceAmount: "100.00",
            baseQuantity: "1",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            discounts: [
              { amount: "10.00", reasonCode: "95" },
            ],
            surcharges: [
              { amount: "5.00", reasonCode: "FC" },
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
            reasonCode: "95",
            amount: "15.00",
            vat: { category: "S", percentage: "21.00" },
          },
        ],
        surcharges: [
          {
            reasonCode: "FC",
            amount: "8.00",
            vat: { category: "S", percentage: "21.00" },
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "invoice with reasonCode only",
      });

      expect(parsed.lines[0].discounts?.[0].reasonCode).toBe("95");
      expect(parsed.lines[0].surcharges?.[0].reasonCode).toBe("FC");
      expect(parsed.discounts?.[0].reasonCode).toBe("95");
      expect(parsed.surcharges?.[0].reasonCode).toBe("FC");

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });

  describe("precalculated vs auto-calculated VAT subtotals", () => {
    it("should produce identical totals and VAT subtotals with precalculated vs simplified VAT object", async () => {
      const baseLines = [
        {
          name: "Item 1 - Standard 21%",
          quantity: "2",
          unitCode: "C62",
          netPriceAmount: "100.00",
          netAmount: null,
          vat: { category: "S" as const, percentage: "21.00" },
          buyersId: null,
          sellersId: null,
          standardId: null,
          description: null,
          originCountry: null,
        },
        {
          name: "Item 2 - Standard 6%",
          quantity: "3",
          unitCode: "C62",
          netPriceAmount: "50.00",
          baseQuantity: "1",
          netAmount: null,
          vat: { category: "S" as const, percentage: "6.00" },
          buyersId: null,
          sellersId: null,
          standardId: null,
          description: null,
          originCountry: null,
        },
        {
          name: "Item 3 - Reverse Charge 21%",
          quantity: "1",
          unitCode: "C62",
          netPriceAmount: "200.00",
          netAmount: null,
          vat: { category: "AE" as const, percentage: "0.00" },
          buyersId: null,
          sellersId: null,
          standardId: null,
          description: null,
          originCountry: null,
        },
        {
          name: "Item 4 - Reverse Charge 0%",
          quantity: "4",
          unitCode: "C62",
          netPriceAmount: "75.00",
          baseQuantity: "1",
          netAmount: null,
          vat: { category: "AE" as const, percentage: "0.00" },
          buyersId: null,
          sellersId: null,
          standardId: null,
          description: null,
          originCountry: null,
        },
      ];

      const invoiceWithPrecalculatedVat = createBaseInvoice({
        lines: baseLines,
        vat: {
          totalVatAmount: "51.00",
          subtotals: [
            {
              taxableAmount: "200.00",
              vatAmount: "42.00",
              category: "S",
              percentage: "21.00",
            },
            {
              taxableAmount: "150.00",
              vatAmount: "9.00",
              category: "S",
              percentage: "6.00",
            },
            {
              taxableAmount: "500.00",
              vatAmount: "0.00",
              category: "AE",
              percentage: "0.00",
              exemptionReason: "VAT Reverse Charge applies",
            },
          ],
        },
      });

      const invoiceWithSimplifiedVat = createBaseInvoice({
        lines: baseLines,
        vat: {
          exemptionReason: "VAT Reverse Charge applies",
        } as any,
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";

      const { parsedInvoice: parsed1 } = await checkInvoiceXML({
        invoice: invoiceWithPrecalculatedVat,
        senderAddress,
        recipientAddress,
        testName: "invoice with precalculated VAT",
        isDocumentValidationEnforced: true,
      });

      const { parsedInvoice: parsed2 } = await checkInvoiceXML({
        invoice: invoiceWithSimplifiedVat,
        senderAddress,
        recipientAddress,
        testName: "invoice with simplified VAT",
        isDocumentValidationEnforced: true,
      });

      expect(parsed1.totals?.taxExclusiveAmount).toBe("850.00");
      expect(parsed1.totals?.taxExclusiveAmount).toBe(parsed2.totals?.taxExclusiveAmount);
      expect(parsed1.totals?.taxInclusiveAmount).toBe(parsed2.totals?.taxInclusiveAmount);
      expect(parsed1.totals?.payableAmount).toBe(parsed2.totals?.payableAmount);
      expect(parsed1.totals?.linesAmount).toBe(parsed2.totals?.linesAmount);

      expect(parsed1.vat?.totalVatAmount).toBe(parsed2.vat?.totalVatAmount);
      expect(parsed1.vat?.subtotals.length).toBe(parsed2.vat?.subtotals.length);

      const sortedSubtotals1 = [...(parsed1.vat?.subtotals || [])].sort((a, b) => {
        const keyA = `${a.category}-${a.percentage}`;
        const keyB = `${b.category}-${b.percentage}`;
        return keyA.localeCompare(keyB);
      });

      const sortedSubtotals2 = [...(parsed2.vat?.subtotals || [])].sort((a, b) => {
        const keyA = `${a.category}-${a.percentage}`;
        const keyB = `${b.category}-${b.percentage}`;
        return keyA.localeCompare(keyB);
      });

      for (let i = 0; i < sortedSubtotals1.length; i++) {
        expect(sortedSubtotals1[i].taxableAmount).toBe(sortedSubtotals2[i].taxableAmount);
        expect(sortedSubtotals1[i].vatAmount).toBe(sortedSubtotals2[i].vatAmount);
        expect(sortedSubtotals1[i].category).toBe(sortedSubtotals2[i].category);
        expect(sortedSubtotals1[i].percentage).toBe(sortedSubtotals2[i].percentage);
        expect(sortedSubtotals1[i].exemptionReason).toBe(sortedSubtotals2[i].exemptionReason);
        expect(sortedSubtotals1[i].exemptionReasonCode).toBe(sortedSubtotals2[i].exemptionReasonCode);
      }

      await sendDocumentViaAPI(invoiceWithPrecalculatedVat, "invoice", recipientAddress);
      await sendDocumentViaAPI(invoiceWithSimplifiedVat, "invoice", recipientAddress);
    });
  });

  describe("specific VAT totals scenario", () => {
    it("should preserve VAT totals with multiple rates including exempt category", async () => {
      const invoice = createBaseInvoice({
        lines: [
          {
            name: "Item 1 - Standard 21%",
            quantity: "10",
            unitCode: "C62",
            netPriceAmount: "235.20",
            baseQuantity: "1",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
          {
            name: "Item 2 - Standard 6%",
            quantity: "2",
            unitCode: "C62",
            netPriceAmount: "98.00",
            netAmount: null,
            vat: { category: "S", percentage: "6.00" },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
          {
            name: "Item 3 - Exempt",
            quantity: "1",
            unitCode: "C62",
            netPriceAmount: "52.00",
            netAmount: null,
            vat: { category: "E", percentage: "0.00" },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
        vat: {
          totalVatAmount: "505.68",
          subtotals: [
            {
              taxableAmount: "2352.00",
              vatAmount: "493.92",
              category: "S",
              percentage: "21.00",
            },
            {
              taxableAmount: "196.00",
              vatAmount: "11.76",
              category: "S",
              percentage: "6.00",
            },
            {
              taxableAmount: "52.00",
              vatAmount: "0.00",
              category: "E",
              percentage: "0.00",
              exemptionReason: "Exempt from tax",
            },
          ],
        },
        totals: {
          paidAmount: "0.00",
          linesAmount: "2600.00",
          payableAmount: "3105.68",
          discountAmount: null,
          surchargeAmount: null,
          taxExclusiveAmount: "2600.00",
          taxInclusiveAmount: "3105.68",
        },
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "VAT totals with multiple rates including exempt category",
      });

      expect(parsed.vat).toBeDefined();
      expect(parsed.vat?.totalVatAmount).toBe("505.68");
      expect(parsed.vat?.subtotals.length).toBe(3);

      const vat21Subtotal = parsed.vat?.subtotals.find(s => s.percentage === "21.00" && s.category === "S");
      expect(vat21Subtotal).toBeDefined();
      expect(vat21Subtotal?.taxableAmount).toBe("2352.00");
      expect(vat21Subtotal?.vatAmount).toBe("493.92");

      const vat6Subtotal = parsed.vat?.subtotals.find(s => s.percentage === "6.00" && s.category === "S");
      expect(vat6Subtotal).toBeDefined();
      expect(vat6Subtotal?.taxableAmount).toBe("196.00");
      expect(vat6Subtotal?.vatAmount).toBe("11.76");

      const vat0Subtotal = parsed.vat?.subtotals.find(s => s.percentage === "0.00" && s.category === "E");
      expect(vat0Subtotal).toBeDefined();
      expect(vat0Subtotal?.taxableAmount).toBe("52.00");
      expect(vat0Subtotal?.vatAmount).toBe("0.00");
      expect(vat0Subtotal?.exemptionReason).toBe("Exempt from tax");

      expect(parsed.totals?.taxExclusiveAmount).toBe("2600.00");
      expect(parsed.totals?.taxInclusiveAmount).toBe("3105.68");
      expect(parsed.totals?.payableAmount).toBe("3105.68");

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });

  describe("address mapping", () => {
    it("should map senderAddress to supplier and recipientAddress to customer", async () => {
      const invoice = createBaseInvoice({
        lines: [
          {
            name: "Item 1",
            quantity: "1",
            unitCode: "C62",
            netPriceAmount: "100.00",
            baseQuantity: "1",
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
      const { ublXml: xml, parsedInvoice } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "address mapping",
      });
      
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: true,
        parseAttributeValue: false,
        parseTagValue: false,
      });
      const parsed = parser.parse(xml);
      const supplierEndpointId = parsed.Invoice.AccountingSupplierParty.Party.EndpointID;
      const customerEndpointId = parsed.Invoice.AccountingCustomerParty.Party.EndpointID;
      
      expect(`${supplierEndpointId["@_schemeID"]}:${supplierEndpointId["#text"]}`).toBe(senderAddress);
      expect(`${customerEndpointId["@_schemeID"]}:${customerEndpointId["#text"]}`).toBe(recipientAddress);

      expect(parsedInvoice.seller.name).toBe(invoice.seller.name);
      expect(parsedInvoice.buyer.name).toBe(invoice.buyer.name);

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });

  describe("enterprise number", () => {
    it("should include enterprise number in seller and buyer when provided", async () => {
      const invoice = createBaseInvoice({
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
            baseQuantity: "1",
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
      const { ublXml: xml, parsedInvoice } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "enterprise number",
      });
      
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
      const supplierEnterpriseNumber = parsed.Invoice.AccountingSupplierParty.Party.PartyLegalEntity.CompanyID;
      const customerEnterpriseNumber = parsed.Invoice.AccountingCustomerParty.Party.PartyLegalEntity.CompanyID;
      
      expect(supplierEnterpriseNumber).toBe("1234567894");
      expect(customerEnterpriseNumber).toBe("9876543210");

      expect(parsedInvoice.seller.name).toBe(invoice.seller.name);
      expect(parsedInvoice.buyer.name).toBe(invoice.buyer.name);

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });

    it("should handle missing enterprise number", async () => {
      const invoice = createBaseInvoice({
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
            baseQuantity: "1",
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
      const { ublXml: xml } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "missing enterprise number",
      });
      
      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });

  describe("VAT category O (Not subject to VAT)", () => {
    it("should handle invoice with VAT category O and exemption reason", async () => {
      const invoice = createBaseInvoice({
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
            baseQuantity: "1",
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
      const { ublXml: xml, parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "VAT category O with exemption reason",
      });
      
      expect(xml).toContain('cbc:ID>O</cbc:ID>');
      expect(xml).toContain("Not subject to VAT according to local legislation");
      expect(xml).toContain('<cbc:CompanyID>1234567894</cbc:CompanyID>');

      expect(parsed.lines[0].vat.category).toBe("O");
      expect(parsed.lines[0].vat.percentage).toBe("0.00");
      expect(parsed.vat?.subtotals.length).toBe(1);
      expect(parsed.vat?.subtotals[0].category).toBe("O");
      expect(parsed.vat?.subtotals[0].vatAmount).toBe("0.00");
      expect(parsed.vat?.subtotals[0].exemptionReason).toBe("Not subject to VAT according to local legislation");
      expect(parsed.totals?.taxExclusiveAmount).toBe("100.00");
      expect(parsed.totals?.taxInclusiveAmount).toBe("100.00");
      expect(parsed.totals?.payableAmount).toBe("100.00");

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });

    it("should not include VAT rate on document-level allowance or charge with VAT category O (BR-O-06, BR-O-07)", async () => {
      const invoice = createBaseInvoice({
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
            netPriceAmount: "1892.00",
            netAmount: null,
            vat: { category: "O", percentage: "00.00" },
            buyersId: null,
            sellersId: null,
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
        discounts: [
          {
            reason: "Voorschotfactuur 202601615",
            amount: "580.80",
            vat: { category: "O", percentage: "00.00" },
          },
        ],
        vat: {
          totalVatAmount: "0.00",
          subtotals: [
            {
              category: "O",
              percentage: "0.00",
              taxableAmount: "1311.20",
              vatAmount: "0.00",
              exemptionReason: "Niet BTW-plichtige VZW",
            },
          ],
        },
        totals: {
          paidAmount: "0.00",
          linesAmount: null,
          payableAmount: "1311.20",
          discountAmount: "580.80",
          surchargeAmount: null,
          taxExclusiveAmount: "1311.20",
          taxInclusiveAmount: "1311.20",
        },
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "VAT category O document-level allowance BR-O-06",
      });

      // BR-O-06: allowance with category O must not have a Percent element
      // BR-O-07: charge with category O must not have a Percent element
      // We can verify by ensuring validation passes (both rules are fatal)
    });
  });

  describe("baseQuantity", () => {
    it("should include BaseQuantity in XML when greater than 1", async () => {
      const invoice = createBaseInvoice({
        lines: [
          {
            name: "Houtschr.HAP VD-TØ3,5x35(200)",
            quantity: "1",
            unitCode: "C62",
            netPriceAmount: "51.98",
            baseQuantity: "10",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            buyersId: null,
            sellersId: "911051",
            standardId: null,
            description: null,
            originCountry: null,
          },
        ],
      });

      const senderAddress = "0208:0428643097";
      const recipientAddress = "0208:0598726857";
      const { ublXml: xml, parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "baseQuantity greater than 1",
      });

      expect(xml).toContain("BaseQuantity");
      expect(xml).toContain("51.98");

      expect(parsed.lines[0].netPriceAmount).toBe("51.98");
      expect(parsed.lines[0].baseQuantity).toBe("10");
    });

    it("should not include BaseQuantity in XML when equal to 1", async () => {
      const invoice = createBaseInvoice({
        lines: [
          {
            name: "Regular item",
            quantity: "5",
            unitCode: "C62",
            netPriceAmount: "10.00",
            baseQuantity: "1",
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
      const { ublXml: xml, parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "baseQuantity equal to 1",
      });

      expect(xml).not.toContain("BaseQuantity");

      expect(parsed.lines[0].netPriceAmount).toBe("10.00");
      expect(parsed.lines[0].baseQuantity).toBe("1");
    });

    it("should preserve baseQuantity through round-trip conversion", async () => {
      const invoice = createBaseInvoice({
        lines: [
          {
            name: "Raamplug mfr 10-135 sb ssks",
            quantity: "2",
            unitCode: "C62",
            netPriceAmount: "73.47",
            baseQuantity: "10",
            netAmount: null,
            vat: { category: "S", percentage: "21.00" },
            buyersId: null,
            sellersId: "993044",
            standardId: null,
            description: null,
            originCountry: null,
          },
          {
            name: "Normal item",
            quantity: "3",
            unitCode: "C62",
            netPriceAmount: "25.00",
            baseQuantity: "1",
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
      const { parsedInvoice: parsed } = await checkInvoiceXML({
        invoice,
        senderAddress,
        recipientAddress,
        testName: "baseQuantity round-trip",
      });

      expect(parsed.lines[0].netPriceAmount).toBe("73.47");
      expect(parsed.lines[0].baseQuantity).toBe("10");
      // PEPPOL-EN16931-R120: LineExtensionAmount = quantity * (netPriceAmount / baseQuantity)
      expect(parsed.lines[0].netAmount).toBe("14.69"); // 2 * (73.47 / 10) = 14.694 → 14.69

      expect(parsed.lines[1].netPriceAmount).toBe("25.00");
      expect(parsed.lines[1].baseQuantity).toBe("1");
      expect(parsed.lines[1].netAmount).toBe("75.00"); // 3 * (25 / 1) = 75.00

      await sendDocumentViaAPI(invoice, "invoice", recipientAddress);
    });
  });
});
