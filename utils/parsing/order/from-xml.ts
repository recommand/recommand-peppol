import { XMLParser } from "fast-xml-parser";
import { parseUblCommodityClassifications } from "../commodity-classifications";
import {
  getNullableNumberContent,
  getNullableTextContent,
  getNumberContent,
  getPercentage,
  getTextContent,
} from "../xml-helpers";
import {
  asArray,
  parseAdditionalItemProperties,
  parseAddress,
  parseAttachments,
  parseIdentifier,
  parseItemIdentifiers,
  parsePeriod,
  POST_AWARD_ARRAY_ELEMENTS,
} from "../operational-ubl";
import { getOrderTypeKeyByCode } from "@peppol/utils/order-types";
import { orderSchema, type Order } from "./schemas";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => POST_AWARD_ARRAY_ELEMENTS.has(name),
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
});

function parseVat(category: any) {
  if (!category) return null;
  return {
    category: getTextContent(category.ID),
    percentage: getPercentage(category.Percent),
  };
}

function parseAllowanceCharges(entries: any, chargeIndicator: "true" | "false") {
  return asArray(entries)
    .filter((entry: any) => getTextContent(entry.ChargeIndicator).trim() === chargeIndicator)
    .map((entry: any) => ({
      reasonCode: getNullableTextContent(entry.AllowanceChargeReasonCode),
      reason: getNullableTextContent(entry.AllowanceChargeReason),
      amount: getNumberContent(entry.Amount),
      vat: parseVat(entry.TaxCategory),
    }));
}

function parseParty(party: any) {
  if (!party) return null;
  const address = parseAddress(party.PostalAddress);
  const companyId = party.PartyLegalEntity?.CompanyID;
  const partyIdentifier = parseIdentifier(asArray(party.PartyIdentification)[0]?.ID);
  const vatScheme = asArray(party.PartyTaxScheme).find(
    (scheme: any) => (getNullableTextContent(scheme?.TaxScheme?.ID) ?? "VAT").trim() === "VAT",
  );
  return {
    name:
      getNullableTextContent(party.PartyName?.Name) ??
      getTextContent(party.PartyLegalEntity?.RegistrationName),
    street: address?.street ?? null,
    street2: address?.street2 ?? null,
    city: address?.city ?? null,
    postalZone: address?.postalZone ?? null,
    country: address?.country ?? null,
    vatNumber: getNullableTextContent(vatScheme?.CompanyID),
    enterpriseNumber: getNullableTextContent(companyId),
    enterpriseNumberScheme: getNullableTextContent(companyId?.["@_schemeID"]),
    partyIdentifiers: partyIdentifier ? [partyIdentifier] : null,
    email: getNullableTextContent(party.Contact?.ElectronicMail),
    phone: getNullableTextContent(party.Contact?.Telephone),
  };
}

export function parseOrderFromXML(xml: string): Order {
  const order = parser.parse(xml).Order;
  if (!order) {
    throw new Error("Invalid XML: No Order element found");
  }

  const buyer = parseParty(order.BuyerCustomerParty?.Party);
  if (!buyer) {
    throw new Error("Invalid XML: No buyer party information found");
  }
  const seller = parseParty(order.SellerSupplierParty?.Party);
  if (!seller) {
    throw new Error("Invalid XML: No seller party information found");
  }

  const delivery = order.Delivery;
  const deliveryTerms = order.DeliveryTerms;
  const totals = order.AnticipatedMonetaryTotal;

  return orderSchema.parse({
    orderNumber: getTextContent(order.ID),
    issueDate: getTextContent(order.IssueDate),
    orderType: order.OrderTypeCode ? getOrderTypeKeyByCode(getTextContent(order.OrderTypeCode)) : null,
    note: getNullableTextContent(order.Note),
    buyerReference: getNullableTextContent(order.CustomerReference),
    validityEndDate: getNullableTextContent(order.ValidityPeriod?.EndDate),
    quotationReference: getNullableTextContent(order.QuotationDocumentReference?.ID),
    salesOrderReference: getNullableTextContent(order.SalesOrderID),
    catalogueReference: getNullableTextContent(order.CatalogueReference?.ID),
    contractReference: getNullableTextContent(order.Contract?.ID),
    projectReference: getNullableTextContent(order.ProjectReference?.ID),
    buyer,
    seller,
    invoicee: parseParty(order.AccountingCustomerParty?.Party),
    delivery: delivery
      ? {
          locationIdentifier: parseIdentifier(delivery.DeliveryLocation?.ID)
            ? {
                scheme: getTextContent(delivery.DeliveryLocation.ID["@_schemeID"]),
                identifier: getTextContent(delivery.DeliveryLocation.ID),
              }
            : null,
          location: parseAddress(delivery.DeliveryLocation?.Address),
          requestedPeriod: parsePeriod(delivery.RequestedDeliveryPeriod),
          recipientName: getNullableTextContent(delivery.DeliveryParty?.PartyName?.Name) ?? undefined,
        }
      : null,
    deliveryTerms: deliveryTerms
      ? {
          code: getNullableTextContent(deliveryTerms.ID),
          specialTerms: getNullableTextContent(deliveryTerms.SpecialTerms),
          location: getNullableTextContent(deliveryTerms.DeliveryLocation?.ID),
        }
      : null,
    paymentTerms: order.PaymentTerms
      ? { note: getTextContent(order.PaymentTerms.Note) }
      : null,
    lines: asArray(order.OrderLine).map((orderLine: any) => {
      const line = orderLine.LineItem ?? {};
      const price = line.Price;
      return {
        id: getNullableTextContent(line.ID),
        name: getTextContent(line.Item?.Name),
        description: getNullableTextContent(line.Item?.Description),
        note: getNullableTextContent(orderLine.Note),
        ...parseItemIdentifiers(line.Item),
        commodityClassifications: parseUblCommodityClassifications(
          asArray(line.Item?.CommodityClassification),
        ),
        additionalItemProperties: parseAdditionalItemProperties(line.Item?.AdditionalItemProperty),
        quantity: getNumberContent(line.Quantity),
        unitCode: getNullableTextContent(line.Quantity?.["@_unitCode"]) ?? "C62",
        netPriceAmount: getNullableNumberContent(price?.PriceAmount),
        baseQuantity: getNullableNumberContent(price?.BaseQuantity),
        netAmount: getNullableNumberContent(line.LineExtensionAmount),
        vat: parseVat(line.Item?.ClassifiedTaxCategory),
        discounts: parseAllowanceCharges(line.AllowanceCharge, "false").map(({ vat, ...rest }) => rest),
        surcharges: parseAllowanceCharges(line.AllowanceCharge, "true").map(({ vat, ...rest }) => rest),
        partialDeliveryAllowed: line.PartialDeliveryIndicator
          ? getTextContent(line.PartialDeliveryIndicator).trim() === "true"
          : null,
        requestedDeliveryPeriod: parsePeriod(line.Delivery?.RequestedDeliveryPeriod),
        quotationLineReference: getNullableTextContent(orderLine.QuotationLineReference?.LineID),
      };
    }),
    discounts: parseAllowanceCharges(order.AllowanceCharge, "false"),
    surcharges: parseAllowanceCharges(order.AllowanceCharge, "true"),
    totals: totals
      ? {
          linesAmount: getNullableNumberContent(totals.LineExtensionAmount),
          discountAmount: getNullableNumberContent(totals.AllowanceTotalAmount),
          surchargeAmount: getNullableNumberContent(totals.ChargeTotalAmount),
          taxExclusiveAmount: getNullableNumberContent(totals.TaxExclusiveAmount),
          taxInclusiveAmount: getNullableNumberContent(totals.TaxInclusiveAmount),
          payableAmount: getNullableNumberContent(totals.PayableAmount),
          paidAmount: getNullableNumberContent(totals.PrepaidAmount),
        }
      : null,
    vat: order.TaxTotal?.TaxAmount
      ? { totalVatAmount: getNumberContent(order.TaxTotal.TaxAmount) }
      : null,
    attachments: parseAttachments(order.AdditionalDocumentReference),
    currency: getTextContent(order.DocumentCurrencyCode),
  });
}
