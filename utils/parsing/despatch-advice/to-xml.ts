import { XMLBuilder } from "fast-xml-parser";
import { UserFacingError } from "@peppol/utils/util";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";
import { parsePeppolAddress } from "../peppol-address";
import type { PartyIdentifier } from "../invoice/schemas";
import {
  additionalItemPropertiesToUBL,
  addressToUBL,
  attachmentsToUBL,
  commodityClassificationsToUBL,
  identifier,
  itemIdentifiersToUBL,
  periodToUBL,
  quantity,
} from "../operational-ubl";
import { getTransportModeCodeByKey } from "@peppol/utils/transport-modes";
import type { DespatchAdvice, DespatchParty } from "./schemas";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

/** The checks the Peppol despatch advice rules make that the JSON schema cannot express. */
export function assertDespatchAdvice(despatchAdvice: DespatchAdvice) {
  for (const party of [despatchAdvice.despatchParty, despatchAdvice.consignee]) {
    if ((party.partyIdentifiers?.length ?? 0) > 1) {
      throw new UserFacingError("A party in a despatch advice can have at most one party identifier.");
    }
  }
  const lineIds = despatchAdvice.lines
    .map((line) => line.id)
    .filter((id): id is string => Boolean(id));
  if (new Set(lineIds).size !== lineIds.length) {
    throw new UserFacingError("Every despatch line needs a unique id.");
  }
  if (despatchAdvice.shipment?.carrier && !despatchAdvice.shipment.consignmentId) {
    throw new UserFacingError(
      "A carrier needs a consignmentId: a despatch advice names the carrier on the consignment.",
    );
  }
}

/** The item instances that state something; an empty one would be an empty element. */
function statedInstances(instances: DespatchAdvice["lines"][number]["itemInstances"]) {
  return (instances ?? []).filter((instance) => Object.values(instance).some(Boolean));
}

function referencedPartyToUBL(party: { name?: string | null; identifier?: PartyIdentifier | null }) {
  return {
    ...(party.identifier && {
      "cac:PartyIdentification": { "cbc:ID": identifier(party.identifier) },
    }),
    ...(party.name && { "cac:PartyName": { "cbc:Name": party.name } }),
  };
}

function contact(party: DespatchParty) {
  if (!party.email && !party.phone) return undefined;
  return {
    "cbc:Name": party.name,
    ...(party.phone && { "cbc:Telephone": party.phone }),
    ...(party.email && { "cbc:ElectronicMail": party.email }),
  };
}

export function despatchAdviceToUBL({
  despatchAdvice,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
  profile,
}: {
  despatchAdvice: DespatchAdvice;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
  profile: XmlProfile;
}): string {
  if (isDocumentValidationEnforced) {
    assertDespatchAdvice(despatchAdvice);
  }

  const party = (value: DespatchParty, endpoint: string) => {
    const { schemeId, identifier: endpointIdentifier } = parsePeppolAddress(endpoint);
    const id = value.partyIdentifiers?.[0];
    return {
      "cbc:EndpointID": { "@_schemeID": schemeId, "#text": endpointIdentifier },
      ...(id && { "cac:PartyIdentification": { "cbc:ID": identifier(id) } }),
      ...(value.country && {
        "cac:PostalAddress": addressToUBL({ ...value, country: value.country }),
      }),
      "cac:PartyLegalEntity": { "cbc:RegistrationName": value.name },
    };
  };

  const shipment = despatchAdvice.shipment;
  const despatchContact = contact(despatchAdvice.despatchParty);
  const deliveryContact = contact(despatchAdvice.consignee);

  return builder.build({
    DespatchAdvice: {
      "@_xmlns": "urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2",
      "@_xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "@_xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      "cbc:CustomizationID": profile.customizationId,
      "cbc:ProfileID": profile.processId,
      "cbc:ID": despatchAdvice.despatchAdviceNumber,
      "cbc:IssueDate": despatchAdvice.issueDate,
      ...(despatchAdvice.note && { "cbc:Note": despatchAdvice.note }),
      ...(despatchAdvice.orderReference && {
        "cac:OrderReference": { "cbc:ID": despatchAdvice.orderReference },
      }),
      ...attachmentsToUBL(despatchAdvice.attachments),
      "cac:DespatchSupplierParty": {
        "cac:Party": {
          ...party(despatchAdvice.despatchParty, senderAddress),
          ...(despatchContact && { "cac:Contact": despatchContact }),
        },
      },
      "cac:DeliveryCustomerParty": {
        "cac:Party": party(despatchAdvice.consignee, recipientAddress),
        ...(deliveryContact && { "cac:DeliveryContact": deliveryContact }),
      },
      ...(despatchAdvice.buyer && {
        "cac:BuyerCustomerParty": { "cac:Party": referencedPartyToUBL(despatchAdvice.buyer) },
      }),
      ...(despatchAdvice.seller && {
        "cac:SellerSupplierParty": { "cac:Party": referencedPartyToUBL(despatchAdvice.seller) },
      }),
      ...(shipment && {
        "cac:Shipment": {
          "cbc:ID": shipment.id || despatchAdvice.despatchAdviceNumber,
          ...(shipment.information && { "cbc:Information": shipment.information }),
          ...(shipment.grossWeight && {
            "cbc:GrossWeightMeasure": quantity(shipment.grossWeight.unitCode, shipment.grossWeight.value),
          }),
          ...(shipment.grossVolume && {
            "cbc:GrossVolumeMeasure": quantity(shipment.grossVolume.unitCode, shipment.grossVolume.value),
          }),
          ...(shipment.handlingUnitCount != null && {
            "cbc:TotalTransportHandlingUnitQuantity": shipment.handlingUnitCount.toString(),
          }),
          ...(shipment.consignmentId && {
            "cac:Consignment": {
              "cbc:ID": shipment.consignmentId,
              ...(shipment.carrier && {
                "cac:CarrierParty": referencedPartyToUBL(shipment.carrier),
              }),
            },
          }),
          ...(shipment.transportMode && {
            "cac:ShipmentStage": { "cbc:TransportModeCode": getTransportModeCodeByKey(shipment.transportMode) },
          }),
          ...((shipment.trackingId || shipment.estimatedDeliveryPeriod || shipment.actualDespatchDate) && {
            "cac:Delivery": {
              ...(shipment.trackingId && { "cbc:TrackingID": shipment.trackingId }),
              ...(shipment.estimatedDeliveryPeriod && {
                "cac:EstimatedDeliveryPeriod": periodToUBL(shipment.estimatedDeliveryPeriod),
              }),
              ...(shipment.actualDespatchDate && {
                "cac:Despatch": { "cbc:ActualDespatchDate": shipment.actualDespatchDate },
              }),
            },
          }),
        },
      }),
      "cac:DespatchLine": despatchAdvice.lines.map((line, index) => ({
        "cbc:ID": line.id || (index + 1).toString(),
        ...(line.note && { "cbc:Note": line.note }),
        "cbc:DeliveredQuantity": quantity(line.unitCode, line.quantity),
        ...(line.outstandingQuantity && {
          "cbc:OutstandingQuantity": quantity(line.unitCode, line.outstandingQuantity),
        }),
        ...(line.outstandingReason && { "cbc:OutstandingReason": line.outstandingReason }),
        "cac:OrderLineReference": {
          "cbc:LineID": line.orderLineReference || "NA",
          ...(line.orderReference && {
            "cac:OrderReference": { "cbc:ID": line.orderReference },
          }),
        },
        "cac:Item": {
          "cbc:Name": line.name,
          ...itemIdentifiersToUBL(line),
          ...commodityClassificationsToUBL(line.commodityClassifications),
          ...additionalItemPropertiesToUBL(line.additionalItemProperties),
          ...(statedInstances(line.itemInstances).length > 0 && {
            "cac:ItemInstance": statedInstances(line.itemInstances).map((instance) => ({
              ...(instance.manufactureDate && { "cbc:ManufactureDate": instance.manufactureDate }),
              ...(instance.bestBeforeDate && { "cbc:BestBeforeDate": instance.bestBeforeDate }),
              ...(instance.serialId && { "cbc:SerialID": instance.serialId }),
              ...((instance.lotNumber || instance.expiryDate) && {
                "cac:LotIdentification": {
                  ...(instance.lotNumber && { "cbc:LotNumberID": instance.lotNumber }),
                  ...(instance.expiryDate && { "cbc:ExpiryDate": instance.expiryDate }),
                },
              }),
            })),
          }),
        },
      })),
    },
  });
}
