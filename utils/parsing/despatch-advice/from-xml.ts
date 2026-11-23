import { XMLParser } from "fast-xml-parser";
import { parseUblCommodityClassifications } from "../commodity-classifications";
import {
  getNullableNumberContent,
  getNullableTextContent,
  getNumberContent,
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
import { getTransportModeKeyByCode } from "@peppol/utils/transport-modes";
import { despatchAdviceSchema, type DespatchAdvice } from "./schemas";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => POST_AWARD_ARRAY_ELEMENTS.has(name),
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
});

function parseParty(party: any, contact: any) {
  const address = parseAddress(party?.PostalAddress);
  const partyIdentifier = parseIdentifier(asArray(party?.PartyIdentification)[0]?.ID);
  return {
    name:
      getNullableTextContent(party?.PartyLegalEntity?.RegistrationName) ??
      getTextContent(party?.PartyName?.Name),
    street: address?.street ?? null,
    street2: address?.street2 ?? null,
    city: address?.city ?? null,
    postalZone: address?.postalZone ?? null,
    country: address?.country ?? null,
    partyIdentifiers: partyIdentifier ? [partyIdentifier] : null,
    email: getNullableTextContent(contact?.ElectronicMail),
    phone: getNullableTextContent(contact?.Telephone),
  };
}

/** A party named or identified, or null when the document gives it neither, as for a carrier named only by its driver. */
function parseReferencedParty(party: any) {
  const name = getNullableTextContent(party?.PartyName?.Name);
  const identifier = parseIdentifier(asArray(party?.PartyIdentification)[0]?.ID);
  return name || identifier ? { name, identifier } : null;
}

function parseMeasure(measure: any) {
  const value = getNullableNumberContent(measure);
  if (!value) return null;
  return { value, unitCode: getTextContent(measure?.["@_unitCode"]) };
}

export function parseDespatchAdviceFromXML(xml: string): DespatchAdvice {
  const despatchAdvice = parser.parse(xml).DespatchAdvice;
  if (!despatchAdvice) {
    throw new Error("Invalid XML: No DespatchAdvice element found");
  }

  const shipment = despatchAdvice.Shipment;
  const consignment = shipment?.Consignment;
  const handlingUnitCount = getNullableTextContent(shipment?.TotalTransportHandlingUnitQuantity);
  const despatchSupplier = despatchAdvice.DespatchSupplierParty?.Party;
  const deliveryCustomer = despatchAdvice.DeliveryCustomerParty;

  return despatchAdviceSchema.parse({
    despatchAdviceNumber: getTextContent(despatchAdvice.ID),
    issueDate: getTextContent(despatchAdvice.IssueDate),
    note: getNullableTextContent(despatchAdvice.Note),
    orderReference: getNullableTextContent(asArray(despatchAdvice.OrderReference)[0]?.ID),
    despatchParty: parseParty(despatchSupplier, despatchSupplier?.Contact),
    consignee: parseParty(deliveryCustomer?.Party, deliveryCustomer?.DeliveryContact),
    buyer: parseReferencedParty(despatchAdvice.BuyerCustomerParty?.Party),
    seller: parseReferencedParty(despatchAdvice.SellerSupplierParty?.Party),
    shipment: shipment
      ? {
          id: getNullableTextContent(shipment.ID),
          information: getNullableTextContent(asArray(shipment.Information)[0]),
          grossWeight: parseMeasure(shipment.GrossWeightMeasure),
          grossVolume: parseMeasure(shipment.GrossVolumeMeasure),
          handlingUnitCount:
            handlingUnitCount && Number.isInteger(Number(handlingUnitCount))
              ? Number(handlingUnitCount)
              : null,
          consignmentId: getNullableTextContent(consignment?.ID),
          carrier: parseReferencedParty(consignment?.CarrierParty),
          transportMode: shipment.ShipmentStage?.TransportModeCode
            ? getTransportModeKeyByCode(getTextContent(shipment.ShipmentStage.TransportModeCode))
            : null,
          trackingId: getNullableTextContent(shipment.Delivery?.TrackingID),
          estimatedDeliveryPeriod: parsePeriod(shipment.Delivery?.EstimatedDeliveryPeriod),
          actualDespatchDate: getNullableTextContent(shipment.Delivery?.Despatch?.ActualDespatchDate),
        }
      : null,
    lines: asArray(despatchAdvice.DespatchLine).map((line: any) => {
      const orderLineReference = line.OrderLineReference;
      const lineId = getNullableTextContent(orderLineReference?.LineID);
      return {
        id: getNullableTextContent(line.ID),
        note: getNullableTextContent(line.Note),
        name: getTextContent(line.Item?.Name),
        ...parseItemIdentifiers(line.Item),
        commodityClassifications: parseUblCommodityClassifications(
          asArray(line.Item?.CommodityClassification),
        ),
        additionalItemProperties: parseAdditionalItemProperties(line.Item?.AdditionalItemProperty),
        quantity: getNumberContent(line.DeliveredQuantity),
        unitCode: getNullableTextContent(line.DeliveredQuantity?.["@_unitCode"]) ?? "C62",
        outstandingQuantity: getNullableNumberContent(line.OutstandingQuantity),
        outstandingReason: getNullableTextContent(asArray(line.OutstandingReason)[0]),
        orderLineReference: lineId === "NA" ? null : lineId,
        orderReference: getNullableTextContent(asArray(orderLineReference?.OrderReference)[0]?.ID),
        itemInstances: asArray(line.Item?.ItemInstance).map((instance: any) => ({
          serialId: getNullableTextContent(instance.SerialID),
          lotNumber: getNullableTextContent(instance.LotIdentification?.LotNumberID),
          expiryDate: getNullableTextContent(instance.LotIdentification?.ExpiryDate),
          bestBeforeDate: getNullableTextContent(instance.BestBeforeDate),
          manufactureDate: getNullableTextContent(instance.ManufactureDate),
        })),
      };
    }),
    attachments: parseAttachments(despatchAdvice.AdditionalDocumentReference),
  });
}
