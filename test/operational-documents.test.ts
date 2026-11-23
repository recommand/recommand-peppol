import { describe, expect, it } from "bun:test";
import { XMLParser } from "fast-xml-parser";
import { orderSchema, type Order } from "../utils/parsing/order/schemas";
import { calculateOrderAmounts } from "../utils/parsing/order/calculations";
import { calculateTotals, extractTotals } from "../utils/parsing/invoice/calculations";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import { orderResponseSchema, type OrderResponse } from "../utils/parsing/order-response/schemas";
import { despatchAdviceSchema, type DespatchAdvice } from "../utils/parsing/despatch-advice/schemas";
import { peppolUblOrderFormat } from "../utils/type-repository/document-formats/peppol-ubl-order";
import { peppolUblOrderResponseFormat } from "../utils/type-repository/document-formats/peppol-ubl-order-response";
import { peppolUblDespatchAdviceFormat } from "../utils/type-repository/document-formats/peppol-ubl-despatch-advice";
import {
  detectDocumentFormat,
  resolveFormatProcessIdCandidates,
} from "../utils/type-repository/document-formats";
import { receivingCapabilities } from "../utils/type-repository/receiving-capabilities";
import { COUNTRIES } from "../utils/countries";
import { orderDocumentType } from "../utils/type-repository/document-types/order";
import { orderResponseDocumentType } from "../utils/type-repository/document-types/orderResponse";
import { despatchAdviceDocumentType } from "../utils/type-repository/document-types/despatchAdvice";
import { emailRecipientAddress } from "../utils/pipelines/sending/email-recipient-address";
import { prepareXmlDocument } from "../utils/pipelines/sending/prepare-xml-document";
import { SendingFailure } from "../utils/pipelines/sending/errors";
import { sendDocumentSchema } from "../utils/parsing/send-document";
import { validateXml } from "./utils/utils";

// The Peppol BIS 3 post-award transactions: Order (T01), Order Response (T76) and
// Despatch Advice (T16). Every document written here is checked against the official
// Peppol rules by the validation service.

const BUYER = "0208:0123456749";
const SELLER = "0088:5790000435951";

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const read = (xml: string) => parser.parse(xml);

const context = (overrides: Partial<{ senderAddress: string; recipientAddress: string }> = {}) => ({
  senderAddress: BUYER,
  recipientAddress: SELLER,
  isDocumentValidationEnforced: true,
  ...overrides,
});

const order = (overrides: Record<string, unknown> = {}): Order =>
  orderSchema.parse({
    orderNumber: "PO-2026-001",
    issueDate: "2026-11-23",
    validityEndDate: "2026-12-01",
    buyer: {
      name: "Buyer NV",
      street: "Kerkstraat 1",
      city: "Gent",
      postalZone: "9000",
      country: "BE",
      vatNumber: "BE0123456749",
      enterpriseNumber: "0123456749",
      enterpriseNumberScheme: "0208",
    },
    seller: {
      name: "Seller BV",
      street: "Dam 1",
      city: "Amsterdam",
      postalZone: "1000AA",
      country: "NL",
      vatNumber: "NL123456789B01",
    },
    lines: [{ name: "Copier paper", quantity: "10", unitCode: "C62", netPriceAmount: "4.25", vat: { category: "S", percentage: "21" } }],
    ...overrides,
  });

const orderResponse = (overrides: Record<string, unknown> = {}): OrderResponse =>
  orderResponseSchema.parse({
    orderResponseNumber: "OR-2026-001",
    issueDate: "2026-11-24",
    response: "accepted",
    orderReference: "PO-2026-001",
    seller: { name: "Seller BV", partyIdentifiers: [{ identifier: "5790000435951", scheme: "0088" }] },
    buyer: { name: "Buyer NV", partyIdentifiers: [{ identifier: "0123456749", scheme: "0208" }] },
    ...overrides,
  });

const despatchAdvice = (overrides: Record<string, unknown> = {}): DespatchAdvice =>
  despatchAdviceSchema.parse({
    despatchAdviceNumber: "DA-2026-001",
    issueDate: "2026-11-25",
    orderReference: "PO-2026-001",
    despatchParty: { name: "Seller BV", street: "Dam 1", city: "Amsterdam", postalZone: "1000AA", country: "NL" },
    consignee: { name: "Buyer NV", street: "Kerkstraat 1", city: "Gent", postalZone: "9000", country: "BE", email: "dock@buyer.example" },
    lines: [{ name: "Copier paper", quantity: "10", sellersId: "P-1", orderLineReference: "1" }],
    ...overrides,
  });

const encodeOrder = (document: Order, processId = peppolUblOrderFormat.supportedProcessIds[0]) =>
  peppolUblOrderFormat.encode(document, processId, context());

describe("order", () => {
  it("writes a valid order with totals and a VAT total when every line has a price and a VAT category", async () => {
    const xml = encodeOrder(
      order({
        discounts: [{ reason: "Volume", amount: "2", vat: { category: "S", percentage: "21" } }],
        lines: [
          { name: "Copier paper", quantity: "10", netPriceAmount: "4.25", vat: { category: "S", percentage: "21" }, discounts: [{ reason: "Promotion", amount: "1" }] },
          { name: "Pens", quantity: "3", netPriceAmount: "2", baseQuantity: "2", vat: { category: "S", percentage: "6" } },
        ],
      }),
    );
    await validateXml(xml, "priced order");

    const totals = read(xml).Order.AnticipatedMonetaryTotal;
    expect(totals.LineExtensionAmount["#text"]).toBe("44.50");
    expect(totals.TaxExclusiveAmount["#text"]).toBe("42.50");
    // 21% of 41.50 - 2.00, and 6% of 3.00.
    expect(read(xml).Order.TaxTotal.TaxAmount["#text"]).toBe("8.48");
    expect(totals.PayableAmount["#text"]).toBe("50.98");
  });

  it("leaves out the VAT total when a line has no VAT category, and expects the amount excluding VAT", async () => {
    const xml = encodeOrder(order({ lines: [{ name: "Paper", quantity: "2", netPriceAmount: "10" }] }));
    await validateXml(xml, "order without VAT");

    const parsed = read(xml).Order;
    expect(parsed.TaxTotal).toBeUndefined();
    expect(parsed.AnticipatedMonetaryTotal.TaxInclusiveAmount).toBeUndefined();
    expect(parsed.AnticipatedMonetaryTotal.PayableAmount["#text"]).toBe("20.00");
  });

  it("states no amounts at all when a line leaves the price to the seller", async () => {
    const xml = encodeOrder(
      order({
        buyer: { name: "Buyer NV" },
        lines: [{ name: "Paper", quantity: "5" }, { name: "Ink", quantity: "1", netPriceAmount: "12", vat: { category: "S", percentage: "21" } }],
      }),
    );
    await validateXml(xml, "unpriced order");

    const parsed = read(xml).Order;
    expect(parsed.AnticipatedMonetaryTotal).toBeUndefined();
    expect(parsed.TaxTotal).toBeUndefined();
    expect(parsed.OrderLine[0].LineItem.LineExtensionAmount).toBeUndefined();
    expect(parsed.OrderLine[0].LineItem.Price).toBeUndefined();
    // A buyer without an address is a valid Peppol buyer.
    expect(parsed.BuyerCustomerParty.Party.PostalAddress).toBeUndefined();
  });

  it("reads back a delivery that names only some of its parts", () => {
    const delivered = order({ delivery: { requestedPeriod: { startDate: "2026-12-01" } } });
    const parsed = peppolUblOrderFormat.decode(encodeOrder(delivered), peppolUblOrderFormat.supportedProcessIds[0]);
    expect(parsed.delivery?.requestedPeriod?.startDate).toBe("2026-12-01");
  });

  it("calculates the amounts of a priced order with VAT as for an invoice", () => {
    const priced = order({
      discounts: [{ reason: "Volume", amount: "2", vat: { category: "S", percentage: "21" } }],
      totals: { paidAmount: "4" },
    });
    const invoiceTotals = extractTotals(calculateTotals(priced as unknown as Invoice));
    const { totals } = calculateOrderAmounts(priced);
    expect(totals).toMatchObject({
      taxExclusiveAmount: invoiceTotals.taxExclusiveAmount,
      taxInclusiveAmount: invoiceTotals.taxInclusiveAmount,
      payableAmount: invoiceTotals.payableAmount,
      paidAmount: invoiceTotals.paidAmount,
      payableRoundingAmount: invoiceTotals.payableRoundingAmount,
    });
  });

  it("writes the order type as its Peppol code and reads it back", () => {
    const xml = encodeOrder(order({ orderType: "blanket_order" }));
    expect(read(xml).Order.OrderTypeCode).toBe("221");
    expect(peppolUblOrderFormat.decode(xml, "").orderType).toBe("blanket_order");
  });

  it("refuses discounts on a line without a price", () => {
    expect(() => order({ lines: [{ name: "Paper", quantity: "5", discounts: [{ reason: "Promotion", amount: "1" }] }] })).toThrow(
      "A line without a netPriceAmount cannot have a netAmount, discounts or surcharges.",
    );
  });

  it("names the buyer as the sender and the seller as the receiver, and travels over the process it names", () => {
    const xml = encodeOrder(order(), "urn:fdc:peppol.eu:poacc:bis:order_only:3");
    const parsed = read(xml).Order;
    expect(parsed.ProfileID).toBe("urn:fdc:peppol.eu:poacc:bis:order_only:3");
    expect(parsed.BuyerCustomerParty.Party.EndpointID["#text"]).toBe("0123456749");
    expect(parsed.SellerSupplierParty.Party.EndpointID["#text"]).toBe("5790000435951");
    // A Peppol order has no place for the seller's VAT number.
    expect(parsed.SellerSupplierParty.Party.PartyTaxScheme).toBeUndefined();
    expect(parsed.BuyerCustomerParty.Party.PartyTaxScheme.CompanyID).toBe("BE0123456749");
  });

  it("refuses a quotation line reference without a quotation reference (PEPPOL-T01-R035)", () => {
    expect(() =>
      encodeOrder(order({ lines: [{ name: "Paper", quantity: "1", quotationLineReference: "3" }] })),
    ).toThrow("PEPPOL-T01-R035");
  });

  it("refuses lines that share an id (PEPPOL-T01-R001)", () => {
    expect(() =>
      encodeOrder(order({ lines: [{ id: "1", name: "Paper", quantity: "1" }, { id: "1", name: "Ink", quantity: "1" }] })),
    ).toThrow("PEPPOL-T01-R001");
  });

  it("prefers the ordering process, which answers with an order response, and registers no advanced ordering", () => {
    expect(resolveFormatProcessIdCandidates(peppolUblOrderFormat, order())).toEqual([
      "urn:fdc:peppol.eu:poacc:bis:ordering:3",
      "urn:fdc:peppol.eu:poacc:bis:order_only:3",
      "urn:fdc:peppol.eu:poacc:bis:advanced_ordering:3",
    ]);
    expect(peppolUblOrderFormat.smpRegistration?.map((registration) => registration.processId)).toEqual([
      "urn:fdc:peppol.eu:poacc:bis:ordering:3",
      "urn:fdc:peppol.eu:poacc:bis:order_only:3",
    ]);
  });

  it("sends raw order XML over the process it declares, and refuses another", () => {
    const orderOnly = "urn:fdc:peppol.eu:poacc:bis:order_only:3";
    const prepare = (extra: Record<string, unknown> = {}) =>
      prepareXmlDocument(
        sendDocumentSchema.parse({
          recipient: SELLER,
          documentType: "xml",
          document: encodeOrder(order(), orderOnly),
          ...extra,
        }),
      );
    expect(prepare().processId).toBe(orderOnly);
    expect(() => prepare({ processId: "urn:fdc:peppol.eu:poacc:bis:ordering:3" })).toThrow(SendingFailure);
  });

  it("defaults the buyer from the sending company and stores the calculated amounts", () => {
    const preprocessed = orderDocumentType.preprocessFromSendAPI(
      {
        documentType: "order",
        document: { orderNumber: "PO-1", seller: order().seller, lines: [{ name: "Paper", quantity: "2", netPriceAmount: "10" }] },
      } as any,
      {
        company: {
          name: "Buyer NV",
          address: "Kerkstraat 1",
          city: "Gent",
          postalCode: "9000",
          country: "BE",
          vatNumber: "BE0123456749",
          enterpriseNumber: "0123456749",
          enterpriseNumberScheme: "0208",
        } as any,
      },
    );
    const parsed = orderDocumentType.documentSchema.parse(preprocessed);
    expect(parsed.buyer.name).toBe("Buyer NV");
    expect(parsed.lines[0].netAmount).toBe("20.00");
    expect(parsed.totals?.payableAmount).toBe("20.00");
    expect(parsed.vat).toBeNull();
  });

  it("addresses an order delivered by email alone to the seller", () => {
    expect(
      emailRecipientAddress({
        documentType: orderDocumentType,
        document: order({ seller: { ...order().seller, enterpriseNumber: "0598726857", enterpriseNumberScheme: "0208" } }),
        format: peppolUblOrderFormat,
        emailTo: ["sales@seller.example"],
      }),
    ).toBe("0208:0598726857");
  });
});

describe("order response", () => {
  const encode = (document: OrderResponse) =>
    peppolUblOrderResponseFormat.encode(document, "urn:fdc:peppol.eu:poacc:bis:ordering:3", context({ senderAddress: SELLER, recipientAddress: BUYER }));

  it("writes a valid acceptance and rejection", async () => {
    await validateXml(encode(orderResponse()), "accepted order response");
    await validateXml(encode(orderResponse({ response: "rejected", note: "Out of stock" })), "rejected order response");
  });

  it("writes a valid conditional acceptance that changes, rejects and substitutes lines", async () => {
    const xml = encode(
      orderResponse({
        response: "conditionally_accepted",
        promisedDeliveryPeriod: { startDate: "2026-12-01", endDate: "2026-12-03" },
        lines: [
          { orderLineReference: "1", status: "changed", name: "Copier paper", quantity: "8", maximumBackorderQuantity: "2", netPriceAmount: "4.50",
            substitute: { name: "Recycled copier paper", sellersId: "P-2" } },
          { orderLineReference: "2", status: "rejected", name: "Pens", note: "No longer sold" },
        ],
      }),
    );
    await validateXml(xml, "conditionally accepted order response");

    // Readable keys in the JSON, Peppol codes in the XML.
    expect(read(xml).OrderResponse.OrderResponseCode).toBe("CA");
    const lines = read(xml).OrderResponse.OrderLine;
    expect(lines.map((line: any) => line.LineItem.LineStatusCode)).toEqual(["3", "7"]);
    // A response line is numbered after the order line it answers, unless given an id.
    expect(lines[0].LineItem.ID).toBe("1");
    expect(lines[0].OrderLineReference.LineID).toBe("1");
    expect(lines[0].SellerSubstitutedLineItem.ID).toBe("1");
  });

  it("requires lines to conditionally accept, and refuses them otherwise (PEPPOL-T76-R007 to R010)", () => {
    expect(() => encode(orderResponse({ response: "conditionally_accepted" }))).toThrow("PEPPOL-T76-R007");
    expect(() =>
      encode(orderResponse({ response: "accepted", lines: [{ orderLineReference: "1", status: "accepted", name: "Paper" }] })),
    ).toThrow("PEPPOL-T76-R008");
  });

  it("refuses two lines with the same id (PEPPOL-T76-R003)", () => {
    expect(() =>
      encode(
        orderResponse({
          response: "conditionally_accepted",
          lines: [
            { orderLineReference: "1", status: "changed", name: "Paper", quantity: "1" },
            { orderLineReference: "1", status: "added", name: "Paper", quantity: "2" },
          ],
        }),
      ),
    ).toThrow("PEPPOL-T76-R003");
  });

  it("refuses a party with neither a name nor an identifier (PEPPOL-T76-R001)", () => {
    expect(() => encode(orderResponse({ buyer: { name: "" } }))).toThrow("PEPPOL-T76-R001");
  });

  it("identifies the responding seller by the company's enterprise number", () => {
    const preprocessed = orderResponseDocumentType.preprocessFromSendAPI(
      { documentType: "orderResponse", document: { ...orderResponse(), seller: undefined } } as any,
      { company: { name: "Seller BV", enterpriseNumber: "0598.726.857", enterpriseNumberScheme: "0208" } as any },
    );
    expect(preprocessed.seller).toEqual({
      name: "Seller BV",
      partyIdentifiers: [{ identifier: "0598726857", scheme: "0208" }],
    });
  });

  it("addresses a response delivered by email alone to the buyer's identifier", () => {
    expect(
      emailRecipientAddress({
        documentType: orderResponseDocumentType,
        document: orderResponse(),
        format: peppolUblOrderResponseFormat,
        emailTo: ["purchasing@buyer.example"],
      }),
    ).toBe("0208:0123456749");
  });
});

describe("despatch advice", () => {
  const encode = (document: DespatchAdvice) =>
    peppolUblDespatchAdviceFormat.encode(document, "urn:fdc:peppol.eu:poacc:bis:despatch_advice:3", context({ senderAddress: SELLER, recipientAddress: BUYER }));

  it("writes a valid despatch advice with a shipment, outstanding quantities and lots", async () => {
    const xml = encode(
      despatchAdvice({
        buyer: { name: "Buyer NV" },
        shipment: {
          grossWeight: { value: "120.5", unitCode: "KGM" },
          handlingUnitCount: 2,
          consignmentId: "CN-1",
          carrier: { name: "Fast Trucks" },
          transportMode: "road",
          trackingId: "TRK-1",
          estimatedDeliveryPeriod: { startDate: "2026-11-26" },
          actualDespatchDate: "2026-11-25",
        },
        lines: [
          { name: "Copier paper", quantity: "8", outstandingQuantity: "2", outstandingReason: "Backorder", orderLineReference: "1", sellersId: "P-1",
            itemInstances: [{ lotNumber: "LOT-42", expiryDate: "2027-01-31" }] },
        ],
      }),
    );
    await validateXml(xml, "despatch advice");

    const parsed = read(xml).DespatchAdvice;
    expect(parsed.Shipment.ID).toBe("DA-2026-001");
    expect(parsed.Shipment.ShipmentStage.TransportModeCode).toBe("3");
    // The consignee's contact is the delivery contact, outside its party.
    expect(parsed.DeliveryCustomerParty.DeliveryContact.ElectronicMail).toBe("dock@buyer.example");
  });

  it("writes NA for a line that names no order line, as Peppol requires one", async () => {
    const xml = encode(despatchAdvice({ lines: [{ name: "Paper", quantity: "1", standardId: { scheme: "0160", identifier: "1234567890128" } }] }));
    await validateXml(xml, "despatch advice without order line");
    expect(read(xml).DespatchAdvice.DespatchLine.OrderLineReference.LineID).toBe("NA");
  });

  it("requires a seller's or standard item identifier on every line (PEPPOL-T16-R003)", () => {
    expect(() => despatchAdvice({ lines: [{ name: "Paper", quantity: "1" }] })).toThrow("PEPPOL-T16-R003");
  });

  it("refuses a carrier without a consignment", () => {
    expect(() => encode(despatchAdvice({ shipment: { carrier: { name: "Fast Trucks" } } }))).toThrow(
      "A carrier needs a consignmentId",
    );
  });

  it("tells the caller what to provide when the consignee cannot be addressed", () => {
    expect(() =>
      emailRecipientAddress({
        documentType: despatchAdviceDocumentType,
        document: despatchAdvice(),
        format: peppolUblDespatchAdviceFormat,
        emailTo: ["dock@buyer.example"],
      }),
    ).toThrow("Provide a partyIdentifier with a scheme for the consignee");
  });
});

describe("post-award formats", () => {
  it("recognise the documents they write", () => {
    expect(detectDocumentFormat(encodeOrder(order()))?.key).toBe("peppol-ubl-order");
    expect(
      detectDocumentFormat(
        peppolUblOrderResponseFormat.encode(orderResponse(), "urn:fdc:peppol.eu:poacc:bis:ordering:3", context()),
      )?.key,
    ).toBe("peppol-ubl-order-response");
    expect(
      detectDocumentFormat(
        peppolUblDespatchAdviceFormat.encode(despatchAdvice(), "urn:fdc:peppol.eu:poacc:bis:despatch_advice:3", context()),
      )?.key,
    ).toBe("peppol-ubl-despatch-advice");
  });

  it("can be registered to receive, but are no country's default", () => {
    const formatKeys = ["peppol-ubl-order", "peppol-ubl-order-response", "peppol-ubl-despatch-advice"];
    expect(
      receivingCapabilities
        .filter((capability) => formatKeys.includes(capability.formatKey))
        .map((capability) => capability.processId),
    ).toEqual([
      "urn:fdc:peppol.eu:poacc:bis:ordering:3",
      "urn:fdc:peppol.eu:poacc:bis:order_only:3",
      "urn:fdc:peppol.eu:poacc:bis:ordering:3",
      "urn:fdc:peppol.eu:poacc:bis:despatch_advice:3",
    ]);
    // A company that registers to receive orders must be ready to process them.
    for (const country of COUNTRIES) {
      expect(
        country.defaultDocumentTypes.filter((capability) => formatKeys.includes(capability.formatKey)),
        country.code,
      ).toEqual([]);
    }
  });
});
