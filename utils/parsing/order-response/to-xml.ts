import { XMLBuilder } from "fast-xml-parser";
import { UserFacingError } from "@peppol/utils/util";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";
import { parsePeppolAddress } from "../peppol-address";
import {
  additionalItemPropertiesToUBL,
  amount,
  commodityClassificationsToUBL,
  identifier,
  itemIdentifiersToUBL,
  periodToUBL,
  quantity,
} from "../operational-ubl";
import { getOrderLineStatusCodeByKey } from "@peppol/utils/order-line-statuses";
import { getOrderResponseCodeByKey } from "@peppol/utils/order-responses";
import type { OrderResponse, OrderResponseParty } from "./schemas";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

/** The checks the Peppol order response rules make that the JSON schema cannot express. */
export function assertOrderResponse(response: OrderResponse) {
  const lineCount = response.lines?.length ?? 0;
  if (response.response === "conditionally_accepted" && lineCount === 0) {
    throw new UserFacingError(
      "A conditionally accepted order response needs lines that say what changes (PEPPOL-T76-R007).",
    );
  }
  if (response.response !== "conditionally_accepted" && lineCount > 0) {
    throw new UserFacingError(
      `Only a conditionally_accepted order response can have lines, not an ${response.response} one (PEPPOL-T76-R008 to R010).`,
    );
  }
  for (const [role, party] of [["seller", response.seller], ["buyer", response.buyer]] as const) {
    if (!party.name && !party.partyIdentifiers?.length) {
      throw new UserFacingError(
        `The ${role} of an order response needs a name or a party identifier (PEPPOL-T76-R001, R002).`,
      );
    }
  }
  const ids = (response.lines ?? []).map((line) => line.id || line.orderLineReference);
  if (new Set(ids).size !== ids.length) {
    throw new UserFacingError(
      "Every order response line needs a unique id (PEPPOL-T76-R003). Give lines that respond to the same order line their own id.",
    );
  }
}

function partyToUBL(party: OrderResponseParty, endpoint: string) {
  const { schemeId, identifier: endpointIdentifier } = parsePeppolAddress(endpoint);
  const identifiers = party.partyIdentifiers ?? [];
  return {
    "cac:Party": {
      "cbc:EndpointID": { "@_schemeID": schemeId, "#text": endpointIdentifier },
      ...(identifiers.length > 0 && {
        "cac:PartyIdentification": identifiers.map((value) => ({ "cbc:ID": identifier(value) })),
      }),
      ...(party.name && {
        "cac:PartyLegalEntity": { "cbc:RegistrationName": party.name },
      }),
    },
  };
}

export function orderResponseToUBL({
  orderResponse,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
  profile,
}: {
  orderResponse: OrderResponse;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
  profile: XmlProfile;
}): string {
  if (isDocumentValidationEnforced) {
    assertOrderResponse(orderResponse);
  }
  const currency = orderResponse.currency;

  return builder.build({
    OrderResponse: {
      "@_xmlns": "urn:oasis:names:specification:ubl:schema:xsd:OrderResponse-2",
      "@_xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "@_xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      "cbc:CustomizationID": profile.customizationId,
      "cbc:ProfileID": profile.processId,
      "cbc:ID": orderResponse.orderResponseNumber,
      ...(orderResponse.salesOrderReference && {
        "cbc:SalesOrderID": orderResponse.salesOrderReference,
      }),
      "cbc:IssueDate": orderResponse.issueDate,
      "cbc:OrderResponseCode": getOrderResponseCodeByKey(orderResponse.response),
      ...(orderResponse.note && { "cbc:Note": orderResponse.note }),
      "cbc:DocumentCurrencyCode": currency,
      ...(orderResponse.buyerReference && {
        "cbc:CustomerReference": orderResponse.buyerReference,
      }),
      "cac:OrderReference": { "cbc:ID": orderResponse.orderReference },
      "cac:SellerSupplierParty": partyToUBL(orderResponse.seller, senderAddress),
      "cac:BuyerCustomerParty": partyToUBL(orderResponse.buyer, recipientAddress),
      ...(orderResponse.promisedDeliveryPeriod && {
        "cac:Delivery": {
          "cac:PromisedDeliveryPeriod": periodToUBL(orderResponse.promisedDeliveryPeriod),
        },
      }),
      ...(orderResponse.lines?.length && {
        "cac:OrderLine": orderResponse.lines.map((line) => {
          const unitCode = line.unitCode || "C62";
          return {
            "cac:LineItem": {
              "cbc:ID": line.id || line.orderLineReference,
              ...(line.note && { "cbc:Note": line.note }),
              "cbc:LineStatusCode": getOrderLineStatusCodeByKey(line.status),
              ...(line.quantity && { "cbc:Quantity": quantity(unitCode, line.quantity) }),
              ...(line.maximumBackorderQuantity && {
                "cbc:MaximumBackorderQuantity": line.maximumBackorderQuantity,
              }),
              ...(line.promisedDeliveryPeriod && {
                "cac:Delivery": {
                  "cac:PromisedDeliveryPeriod": periodToUBL(line.promisedDeliveryPeriod),
                },
              }),
              ...(line.netPriceAmount && {
                "cac:Price": {
                  "cbc:PriceAmount": amount(currency, line.netPriceAmount),
                  ...(line.baseQuantity &&
                    line.baseQuantity !== "1" && {
                      "cbc:BaseQuantity": quantity(unitCode, line.baseQuantity),
                    }),
                },
              }),
              "cac:Item": {
                "cbc:Name": line.name,
                ...itemIdentifiersToUBL(line),
              },
            },
            ...(line.substitute && Object.values(line.substitute).some(Boolean) && {
              "cac:SellerSubstitutedLineItem": {
                "cbc:ID": line.substitute.id || line.id || line.orderLineReference,
                "cac:Item": {
                  ...(line.substitute.name && { "cbc:Name": line.substitute.name }),
                  ...itemIdentifiersToUBL({
                    sellersId: line.substitute.sellersId,
                    standardId: line.substitute.standardId,
                  }),
                  ...commodityClassificationsToUBL(line.substitute.commodityClassifications),
                  ...(line.substitute.vat && {
                    "cac:ClassifiedTaxCategory": {
                      "cbc:ID": line.substitute.vat.category,
                      ...(line.substitute.vat.category !== "O" && {
                        "cbc:Percent": line.substitute.vat.percentage,
                      }),
                      "cac:TaxScheme": { "cbc:ID": "VAT" },
                    },
                  }),
                  ...additionalItemPropertiesToUBL(line.substitute.additionalItemProperties),
                },
              },
            }),
            "cac:OrderLineReference": { "cbc:LineID": line.orderLineReference },
          };
        }),
      }),
    },
  });
}
