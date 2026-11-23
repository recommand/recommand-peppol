import { XMLBuilder } from "fast-xml-parser";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";
import { parsePeppolAddress } from "../peppol-address";
import {
  additionalItemPropertiesToUBL,
  addressToUBL,
  amount,
  attachmentsToUBL,
  commodityClassificationsToUBL,
  contactToUBL,
  identifier,
  itemIdentifiersToUBL,
  periodToUBL,
  quantity,
} from "../operational-ubl";
import { getOrderTypeCodeByKey } from "@peppol/utils/order-types";
import { assertOrder, calculateOrderAmounts } from "./calculations";
import type { Order, OrderParty } from "./schemas";

const isNonZero = (value: string | null | undefined): value is string =>
  Boolean(value) && Number(value) !== 0;

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

export function orderToUBL({
  order,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
  profile,
}: {
  order: Order;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
  profile: XmlProfile;
}): string {
  if (isDocumentValidationEnforced) {
    assertOrder(order);
  }
  const { lines, totals, vat } = calculateOrderAmounts(order);
  const currency = order.currency;

  const partyToUBL = (
    party: OrderParty,
    options: { endpoint?: string; withTaxScheme: boolean },
  ) => {
    const endpoint = options.endpoint ? parsePeppolAddress(options.endpoint) : null;
    const partyIdentifier = party.partyIdentifiers?.[0];
    return {
      "cac:Party": {
        ...(endpoint && {
          "cbc:EndpointID": { "@_schemeID": endpoint.schemeId, "#text": endpoint.identifier },
        }),
        ...(partyIdentifier && {
          "cac:PartyIdentification": { "cbc:ID": identifier(partyIdentifier) },
        }),
        "cac:PartyName": { "cbc:Name": party.name },
        ...(party.country && {
          "cac:PostalAddress": addressToUBL({ ...party, country: party.country }),
        }),
        ...(options.withTaxScheme &&
          party.vatNumber && {
            "cac:PartyTaxScheme": {
              "cbc:CompanyID": party.vatNumber,
              "cac:TaxScheme": { "cbc:ID": "VAT" },
            },
          }),
        "cac:PartyLegalEntity": {
          "cbc:RegistrationName": party.name,
          ...(party.enterpriseNumber && {
            "cbc:CompanyID": identifier({
              identifier: party.enterpriseNumber,
              scheme: party.enterpriseNumberScheme,
            }),
          }),
        },
        ...contactToUBL(party),
      },
    };
  };

  const allowanceCharge = (
    chargeIndicator: boolean,
    entry: { reasonCode?: string | null; reason?: string | null; amount: string; vat?: { category: string; percentage: string } | null },
  ) => ({
    "cbc:ChargeIndicator": chargeIndicator ? "true" : "false",
    ...(entry.reasonCode && { "cbc:AllowanceChargeReasonCode": entry.reasonCode }),
    ...(entry.reason && { "cbc:AllowanceChargeReason": entry.reason }),
    "cbc:Amount": amount(currency, entry.amount),
    ...(entry.vat && {
      "cac:TaxCategory": {
        "cbc:ID": entry.vat.category,
        ...(entry.vat.category !== "O" && { "cbc:Percent": entry.vat.percentage }),
        "cac:TaxScheme": { "cbc:ID": "VAT" },
      },
    }),
  });

  const delivery = order.delivery;
  const deliveryTerms = order.deliveryTerms;

  return builder.build({
    Order: {
      "@_xmlns": "urn:oasis:names:specification:ubl:schema:xsd:Order-2",
      "@_xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "@_xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      "cbc:CustomizationID": profile.customizationId,
      "cbc:ProfileID": profile.processId,
      "cbc:ID": order.orderNumber,
      ...(order.salesOrderReference && { "cbc:SalesOrderID": order.salesOrderReference }),
      "cbc:IssueDate": order.issueDate,
      ...(order.orderType && { "cbc:OrderTypeCode": getOrderTypeCodeByKey(order.orderType) }),
      ...(order.note && { "cbc:Note": order.note }),
      "cbc:DocumentCurrencyCode": currency,
      ...(order.buyerReference && { "cbc:CustomerReference": order.buyerReference }),
      ...(order.validityEndDate && {
        "cac:ValidityPeriod": { "cbc:EndDate": order.validityEndDate },
      }),
      ...(order.quotationReference && {
        "cac:QuotationDocumentReference": { "cbc:ID": order.quotationReference },
      }),
      ...(order.catalogueReference && {
        "cac:CatalogueReference": { "cbc:ID": order.catalogueReference },
      }),
      ...attachmentsToUBL(order.attachments),
      ...(order.contractReference && {
        "cac:Contract": { "cbc:ID": order.contractReference },
      }),
      ...(order.projectReference && {
        "cac:ProjectReference": { "cbc:ID": order.projectReference },
      }),
      "cac:BuyerCustomerParty": partyToUBL(order.buyer, {
        endpoint: senderAddress,
        withTaxScheme: true,
      }),
      "cac:SellerSupplierParty": partyToUBL(order.seller, {
        endpoint: recipientAddress,
        withTaxScheme: false,
      }),
      ...(order.invoicee && {
        "cac:AccountingCustomerParty": partyToUBL(order.invoicee, {
          withTaxScheme: true,
        }),
      }),
      ...(delivery &&
        (delivery.location || delivery.requestedPeriod || delivery.recipientName) && {
          "cac:Delivery": {
            // An order's delivery location always has an address.
            ...(delivery.location && {
              "cac:DeliveryLocation": {
                ...(delivery.locationIdentifier && {
                  "cbc:ID": identifier(delivery.locationIdentifier),
                }),
                "cac:Address": addressToUBL(delivery.location),
              },
            }),
            ...(delivery.requestedPeriod && {
              "cac:RequestedDeliveryPeriod": periodToUBL(delivery.requestedPeriod),
            }),
            ...(delivery.recipientName && {
              "cac:DeliveryParty": {
                "cac:PartyName": { "cbc:Name": delivery.recipientName },
              },
            }),
          },
        }),
      ...(deliveryTerms &&
        (deliveryTerms.code || deliveryTerms.specialTerms || deliveryTerms.location) && {
          "cac:DeliveryTerms": {
            ...(deliveryTerms.code && { "cbc:ID": deliveryTerms.code }),
            ...(deliveryTerms.specialTerms && { "cbc:SpecialTerms": deliveryTerms.specialTerms }),
            ...(deliveryTerms.location && {
              "cac:DeliveryLocation": { "cbc:ID": deliveryTerms.location },
            }),
          },
        }),
      ...(order.paymentTerms && {
        "cac:PaymentTerms": { "cbc:Note": order.paymentTerms.note },
      }),
      ...((order.discounts?.length || order.surcharges?.length) && {
        "cac:AllowanceCharge": [
          ...(order.discounts ?? []).map((discount) => allowanceCharge(false, discount)),
          ...(order.surcharges ?? []).map((surcharge) => allowanceCharge(true, surcharge)),
        ],
      }),
      ...(vat && {
        "cac:TaxTotal": { "cbc:TaxAmount": amount(currency, vat.totalVatAmount) },
      }),
      ...(totals && {
        "cac:AnticipatedMonetaryTotal": {
          "cbc:LineExtensionAmount": amount(currency, totals.linesAmount),
          "cbc:TaxExclusiveAmount": amount(currency, totals.taxExclusiveAmount),
          ...(totals.taxInclusiveAmount && {
            "cbc:TaxInclusiveAmount": amount(currency, totals.taxInclusiveAmount),
          }),
          ...(totals.discountAmount && {
            "cbc:AllowanceTotalAmount": amount(currency, totals.discountAmount),
          }),
          ...(totals.surchargeAmount && {
            "cbc:ChargeTotalAmount": amount(currency, totals.surchargeAmount),
          }),
          ...(isNonZero(totals.paidAmount) && {
            "cbc:PrepaidAmount": amount(currency, totals.paidAmount),
          }),
          ...(isNonZero(totals.payableRoundingAmount) && {
            "cbc:PayableRoundingAmount": amount(currency, totals.payableRoundingAmount),
          }),
          "cbc:PayableAmount": amount(currency, totals.payableAmount),
        },
      }),
      "cac:OrderLine": lines.map((line, index) => ({
        ...(line.note && { "cbc:Note": line.note }),
        "cac:LineItem": {
          "cbc:ID": line.id || (index + 1).toString(),
          "cbc:Quantity": quantity(line.unitCode, line.quantity),
          ...(line.netAmount && {
            "cbc:LineExtensionAmount": amount(currency, line.netAmount),
          }),
          ...(line.partialDeliveryAllowed != null && {
            "cbc:PartialDeliveryIndicator": line.partialDeliveryAllowed ? "true" : "false",
          }),
          ...(line.requestedDeliveryPeriod && {
            "cac:Delivery": {
              "cac:RequestedDeliveryPeriod": periodToUBL(line.requestedDeliveryPeriod),
            },
          }),
          ...((line.discounts?.length || line.surcharges?.length) && {
            "cac:AllowanceCharge": [
              ...(line.discounts ?? []).map((discount) => allowanceCharge(false, discount)),
              ...(line.surcharges ?? []).map((surcharge) => allowanceCharge(true, surcharge)),
            ],
          }),
          ...(line.netPriceAmount != null && {
            "cac:Price": {
              "cbc:PriceAmount": amount(currency, line.netPriceAmount),
              ...(line.baseQuantity &&
                line.baseQuantity !== "1" && {
                  "cbc:BaseQuantity": quantity(line.unitCode, line.baseQuantity),
                }),
            },
          }),
          "cac:Item": {
            ...(line.description && { "cbc:Description": line.description }),
            "cbc:Name": line.name,
            ...itemIdentifiersToUBL(line),
            ...commodityClassificationsToUBL(line.commodityClassifications),
            ...(line.vat && {
              "cac:ClassifiedTaxCategory": {
                "cbc:ID": line.vat.category,
                ...(line.vat.category !== "O" && { "cbc:Percent": line.vat.percentage }),
                "cac:TaxScheme": { "cbc:ID": "VAT" },
              },
            }),
            ...additionalItemPropertiesToUBL(line.additionalItemProperties),
          },
        },
        ...(line.quotationLineReference && {
          "cac:QuotationLineReference": { "cbc:LineID": line.quotationLineReference },
        }),
      })),
    },
  });
}
