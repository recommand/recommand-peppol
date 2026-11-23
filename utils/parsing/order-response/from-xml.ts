import { XMLParser } from "fast-xml-parser";
import { parseUblCommodityClassifications } from "../commodity-classifications";
import {
  getNullableNumberContent,
  getNullableTextContent,
  getPercentage,
  getTextContent,
} from "../xml-helpers";
import {
  asArray,
  parseAdditionalItemProperties,
  parseIdentifier,
  parseItemIdentifiers,
  parsePeriod,
  POST_AWARD_ARRAY_ELEMENTS,
} from "../operational-ubl";
import { getOrderLineStatusKeyByCode } from "@peppol/utils/order-line-statuses";
import { getOrderResponseKeyByCode } from "@peppol/utils/order-responses";
import { orderResponseSchema, type OrderResponse } from "./schemas";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => POST_AWARD_ARRAY_ELEMENTS.has(name),
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
});

function parseParty(party: any) {
  const partyIdentifiers = asArray(party?.PartyIdentification)
    .map((identification: any) => parseIdentifier(identification?.ID))
    .filter((value) => value !== null);
  return {
    name: getTextContent(party?.PartyLegalEntity?.RegistrationName),
    partyIdentifiers: partyIdentifiers.length > 0 ? partyIdentifiers : null,
  };
}

export function parseOrderResponseFromXML(xml: string): OrderResponse {
  const response = parser.parse(xml).OrderResponse;
  if (!response) {
    throw new Error("Invalid XML: No OrderResponse element found");
  }

  const lines = asArray(response.OrderLine).map((orderLine: any) => {
    const line = orderLine.LineItem ?? {};
    const substitute = orderLine.SellerSubstitutedLineItem;
    const substituteCategory = substitute?.Item?.ClassifiedTaxCategory;
    return {
      id: getNullableTextContent(line.ID),
      orderLineReference: getTextContent(orderLine.OrderLineReference?.LineID),
      status: getOrderLineStatusKeyByCode(getTextContent(line.LineStatusCode)),
      note: getNullableTextContent(line.Note),
      quantity: getNullableNumberContent(line.Quantity),
      unitCode: getNullableTextContent(line.Quantity?.["@_unitCode"]),
      maximumBackorderQuantity: getNullableNumberContent(line.MaximumBackorderQuantity),
      promisedDeliveryPeriod: parsePeriod(line.Delivery?.PromisedDeliveryPeriod),
      netPriceAmount: getNullableNumberContent(line.Price?.PriceAmount),
      baseQuantity: getNullableNumberContent(line.Price?.BaseQuantity),
      name: getTextContent(line.Item?.Name),
      ...parseItemIdentifiers(line.Item),
      substitute: substitute
        ? {
            id: getNullableTextContent(substitute.ID),
            name: getNullableTextContent(substitute.Item?.Name),
            sellersId: getNullableTextContent(substitute.Item?.SellersItemIdentification?.ID),
            standardId: parseItemIdentifiers(substitute.Item).standardId,
            commodityClassifications: parseUblCommodityClassifications(
              asArray(substitute.Item?.CommodityClassification),
            ),
            vat: substituteCategory
              ? {
                  category: getTextContent(substituteCategory.ID),
                  percentage: getPercentage(substituteCategory.Percent),
                }
              : null,
            additionalItemProperties: parseAdditionalItemProperties(
              substitute.Item?.AdditionalItemProperty,
            ),
          }
        : null,
    };
  });

  return orderResponseSchema.parse({
    orderResponseNumber: getTextContent(response.ID),
    issueDate: getTextContent(response.IssueDate),
    response: getOrderResponseKeyByCode(getTextContent(response.OrderResponseCode)),
    note: getNullableTextContent(response.Note),
    orderReference: getTextContent(asArray(response.OrderReference)[0]?.ID),
    salesOrderReference: getNullableTextContent(response.SalesOrderID),
    buyerReference: getNullableTextContent(response.CustomerReference),
    seller: parseParty(response.SellerSupplierParty?.Party),
    buyer: parseParty(response.BuyerCustomerParty?.Party),
    promisedDeliveryPeriod: parsePeriod(response.Delivery?.PromisedDeliveryPeriod),
    lines: lines.length > 0 ? lines : null,
    currency: getTextContent(response.DocumentCurrencyCode),
  });
}
