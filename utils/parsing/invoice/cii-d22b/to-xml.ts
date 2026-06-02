import { XMLBuilder } from "fast-xml-parser";
import type { Invoice, Party } from "../schemas";
import { calculateDocumentTotals } from "../calculations";
import { parsePeppolAddress } from "../../peppol-address";
import { getPaymentCodeByKey } from "@peppol/utils/payment-means";
import { CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO } from "@peppol/utils/document-types";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

type XmlNode = Record<string, unknown>;

const FRANCE_CII_CUSTOMIZATION_ID = CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId.split("##")[1].split("::")[0];

function amount(value: string | null | undefined, currency: string): XmlNode {
  void currency;
  return {
    "#text": value ?? "0.00",
  };
}

function currencyAmount(value: string | null | undefined, currency: string): XmlNode {
  return {
    "@_currencyID": currency,
    "#text": value ?? "0.00",
  };
}

function quantity(value: string, unitCode: string): XmlNode {
  return {
    "@_unitCode": unitCode,
    "#text": value,
  };
}

function id(value: string, schemeID?: string | null): XmlNode {
  return {
    ...(schemeID && { "@_schemeID": schemeID }),
    "#text": value,
  };
}

function indicator(value: boolean): XmlNode {
  return {
    "udt:Indicator": value ? "true" : "false",
  };
}

function dateTime(date: string): XmlNode {
  return {
    "udt:DateTimeString": {
      "@_format": "102",
      "#text": date.replaceAll("-", ""),
    },
  };
}

function contact(party: Party): XmlNode | undefined {
  if (!party.phone && !party.email) {
    return undefined;
  }

  return {
    "ram:PersonName": party.name,
    ...(party.phone && {
      "ram:TelephoneUniversalCommunication": {
        "ram:CompleteNumber": party.phone,
      },
    }),
    ...(party.email && {
      "ram:EmailURIUniversalCommunication": {
        "ram:URIID": party.email,
      },
    }),
  };
}

function tradeAddress(party: Party): XmlNode {
  return {
    "ram:PostcodeCode": party.postalZone,
    "ram:LineOne": party.street,
    ...(party.street2 && { "ram:LineTwo": party.street2 }),
    "ram:CityName": party.city,
    "ram:CountryID": party.country,
  };
}

function tradeParty(party: Party, peppolAddress: string): XmlNode {
  const parsedAddress = parsePeppolAddress(peppolAddress);
  const partyContact = contact(party);

  return {
    "ram:Name": party.name,
    ...(party.enterpriseNumber && {
      "ram:SpecifiedLegalOrganization": {
        "ram:ID": id(party.enterpriseNumber, party.enterpriseNumberScheme),
      },
    }),
    ...(partyContact && { "ram:DefinedTradeContact": partyContact }),
    "ram:PostalTradeAddress": tradeAddress(party),
    ...(party.vatNumber && {
      "ram:SpecifiedTaxRegistration": {
        "ram:ID": id(party.vatNumber, "VA"),
      },
    }),
    "ram:EndPointURIUniversalCommunication": {
      "ram:URIID": id(parsedAddress.identifier, parsedAddress.schemeId),
    },
  };
}

function deliveryTradeParty(invoice: Invoice): XmlNode | undefined {
  if (!invoice.delivery?.recipientName && !invoice.delivery?.location && !invoice.delivery?.locationIdentifier) {
    return undefined;
  }

  return {
    ...(invoice.delivery?.locationIdentifier && {
      "ram:ID": id(
        invoice.delivery.locationIdentifier.identifier,
        invoice.delivery.locationIdentifier.scheme
      ),
    }),
    ...(invoice.delivery?.recipientName && { "ram:Name": invoice.delivery.recipientName }),
    ...(invoice.delivery?.location && {
      "ram:PostalTradeAddress": {
        ...(invoice.delivery.location.postalZone && {
          "ram:PostcodeCode": invoice.delivery.location.postalZone,
        }),
        ...(invoice.delivery.location.street && {
          "ram:LineOne": invoice.delivery.location.street,
        }),
        ...(invoice.delivery.location.street2 && {
          "ram:LineTwo": invoice.delivery.location.street2,
        }),
        ...(invoice.delivery.location.city && {
          "ram:CityName": invoice.delivery.location.city,
        }),
        "ram:CountryID": invoice.delivery.location.country,
      },
    }),
  };
}

function tradeTax({
  category,
  percentage,
  currency,
  calculatedAmount,
  basisAmount,
  exemptionReasonCode,
  exemptionReason,
}: {
  category: string;
  percentage: string;
  currency: string;
  calculatedAmount?: string | null;
  basisAmount?: string | null;
  exemptionReasonCode?: string | null;
  exemptionReason?: string | null;
}): XmlNode {
  return {
    ...(calculatedAmount && {
      "ram:CalculatedAmount": amount(calculatedAmount, currency),
    }),
    "ram:TypeCode": "VAT",
    ...(exemptionReason && { "ram:ExemptionReason": exemptionReason }),
    ...(basisAmount && { "ram:BasisAmount": amount(basisAmount, currency) }),
    "ram:CategoryCode": category,
    ...(exemptionReasonCode && { "ram:ExemptionReasonCode": exemptionReasonCode }),
    ...(category !== "O" && { "ram:RateApplicablePercent": percentage }),
  };
}

function allowanceCharge({
  isCharge,
  reasonCode,
  reason,
  actualAmount,
  currency,
  vat,
}: {
  isCharge: boolean;
  reasonCode?: string | null;
  reason?: string | null;
  actualAmount: string;
  currency: string;
  vat?: { category: string; percentage: string };
}): XmlNode {
  return {
    "ram:ChargeIndicator": indicator(isCharge),
    "ram:ActualAmount": amount(actualAmount, currency),
    ...(reasonCode && { "ram:ReasonCode": reasonCode }),
    ...(reason && { "ram:Reason": reason }),
    ...(vat && {
      "ram:CategoryTradeTax": tradeTax({
        category: vat.category,
        percentage: vat.percentage,
        currency,
      }),
    }),
  };
}

function additionalDocumentReference(attachment: NonNullable<Invoice["attachments"]>[number]): XmlNode {
  return {
    "ram:IssuerAssignedID": attachment.id,
    ...(attachment.url && { "ram:URIID": attachment.url }),
    "ram:TypeCode": "916",
    ...(attachment.description && { "ram:Name": attachment.description }),
    ...(attachment.embeddedDocument && {
      "ram:AttachmentBinaryObject": {
        "@_mimeCode": attachment.mimeCode,
        "@_filename": attachment.filename,
        "#text": attachment.embeddedDocument,
      },
    }),
  };
}

export function invoiceToCII({
  invoice,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
}: {
  invoice: Invoice;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
}): string {
  const ciiInvoice = prebuildInvoiceCII({
    invoice,
    supplierAddress: senderAddress,
    customerAddress: recipientAddress,
    isDocumentValidationEnforced,
  });
  return builder.build(ciiInvoice);
}

export function prebuildInvoiceCII({
  invoice,
  supplierAddress,
  customerAddress,
  isDocumentValidationEnforced,
}: {
  invoice: Invoice;
  supplierAddress: string;
  customerAddress: string;
  isDocumentValidationEnforced: boolean;
}) {
  const { vat, lines, extractedTotals } = calculateDocumentTotals({
    document: invoice,
    isDocumentValidationEnforced,
  });
  const shipToTradeParty = deliveryTradeParty(invoice);
  const paymentReferences =
    invoice.paymentMeans
      ?.map((payment) => payment.reference)
      .filter((reference): reference is string => Boolean(reference)) ?? [];

  return {
    CrossIndustryInvoice: {
      "@_xmlns": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
      "@_xmlns:ram":
        "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
      "@_xmlns:qdt": "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
      "@_xmlns:udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
      ExchangedDocumentContext: {
        "ram:BusinessProcessSpecifiedDocumentContextParameter": {
          "ram:ID": CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.processId,
        },
        "ram:GuidelineSpecifiedDocumentContextParameter": {
          "ram:ID": FRANCE_CII_CUSTOMIZATION_ID,
        },
      },
      ExchangedDocument: {
        "ram:ID": invoice.invoiceNumber,
        "ram:TypeCode": "380",
        "ram:IssueDateTime": dateTime(invoice.issueDate),
        ...(invoice.note && {
          "ram:IncludedNote": {
            "ram:Content": invoice.note,
          },
        }),
      },
      SupplyChainTradeTransaction: {
        "ram:IncludedSupplyChainTradeLineItem": lines.map((item, index) => ({
          "ram:AssociatedDocumentLineDocument": {
            "ram:LineID":
              item.id === undefined || item.id === null ? (index + 1).toString() : item.id,
            ...(item.note && {
              "ram:IncludedNote": {
                "ram:Content": item.note,
              },
            }),
          },
          "ram:SpecifiedTradeProduct": {
            ...(item.standardId && {
              "ram:GlobalID": id(item.standardId.identifier, item.standardId.scheme),
            }),
            ...(item.sellersId && { "ram:SellerAssignedID": item.sellersId }),
            ...(item.buyersId && { "ram:BuyerAssignedID": item.buyersId }),
            "ram:Name": item.name,
            ...(item.description && { "ram:Description": item.description }),
            ...((item.additionalItemProperties && item.additionalItemProperties.length > 0) && {
              "ram:ApplicableProductCharacteristic": item.additionalItemProperties.map((property) => ({
                "ram:Description": property.name,
                "ram:Value": property.value,
              })),
            }),
            ...((item.commodityClassifications && item.commodityClassifications.length > 0) && {
              "ram:DesignatedProductClassification": item.commodityClassifications.map((classification) => ({
                "ram:ClassCode": {
                  "@_listID": classification.scheme,
                  ...(classification.schemeVersion && {
                    "@_listVersionID": classification.schemeVersion,
                  }),
                  "#text": classification.value,
                },
              })),
            }),
            ...(item.originCountry && {
              "ram:OriginTradeCountry": {
                "ram:ID": item.originCountry,
              },
            }),
          },
          "ram:SpecifiedLineTradeAgreement": {
            ...(item.orderLineReference && {
              "ram:BuyerOrderReferencedDocument": {
                "ram:LineID": item.orderLineReference,
              },
            }),
            ...(item.documentReference && {
              "ram:AdditionalReferencedDocument": {
                "ram:IssuerAssignedID": item.documentReference,
                "ram:TypeCode": "130",
              },
            }),
            "ram:NetPriceProductTradePrice": {
              "ram:ChargeAmount": amount(item.netPriceAmount, invoice.currency),
              ...(item.baseQuantity && item.baseQuantity !== "1" && {
                "ram:BasisQuantity": quantity(item.baseQuantity, item.unitCode),
              }),
            },
          },
          "ram:SpecifiedLineTradeDelivery": {
            "ram:BilledQuantity": quantity(item.quantity, item.unitCode),
          },
          "ram:SpecifiedLineTradeSettlement": {
            "ram:ApplicableTradeTax": tradeTax({
              category: item.vat.category,
              percentage: item.vat.percentage,
              currency: invoice.currency,
            }),
            ...((item.discounts || item.surcharges) && {
              "ram:SpecifiedTradeAllowanceCharge": [
                ...(item.discounts?.map((discount) =>
                  allowanceCharge({
                    isCharge: false,
                    reasonCode: discount.reasonCode,
                    reason: discount.reason,
                    actualAmount: discount.amount,
                    currency: invoice.currency,
                  })
                ) || []),
                ...(item.surcharges?.map((surcharge) =>
                  allowanceCharge({
                    isCharge: true,
                    reasonCode: surcharge.reasonCode,
                    reason: surcharge.reason,
                    actualAmount: surcharge.amount,
                    currency: invoice.currency,
                  })
                ) || []),
              ],
            }),
            "ram:SpecifiedTradeSettlementLineMonetarySummation": {
              "ram:LineTotalAmount": amount(item.netAmount, invoice.currency),
            },
          },
        })),
        "ram:ApplicableHeaderTradeAgreement": {
          ...(invoice.buyerReference && {
            "ram:BuyerReference": invoice.buyerReference,
          }),
          ...(!invoice.buyerReference &&
            !invoice.purchaseOrderReference && {
              "ram:BuyerReference": invoice.invoiceNumber,
            }),
          "ram:SellerTradeParty": tradeParty(invoice.seller, supplierAddress),
          "ram:BuyerTradeParty": tradeParty(invoice.buyer, customerAddress),
          ...(invoice.salesOrderReference && {
            "ram:SellerOrderReferencedDocument": {
              "ram:IssuerAssignedID": invoice.salesOrderReference,
            },
          }),
          ...(invoice.purchaseOrderReference && {
            "ram:BuyerOrderReferencedDocument": {
              "ram:IssuerAssignedID": invoice.purchaseOrderReference,
            },
          }),
          ...(invoice.attachments && {
            "ram:AdditionalReferencedDocument": invoice.attachments.map(additionalDocumentReference),
          }),
        },
        "ram:ApplicableHeaderTradeDelivery": {
          ...(shipToTradeParty && { "ram:ShipToTradeParty": shipToTradeParty }),
          ...(invoice.delivery?.date && {
            "ram:ActualDeliverySupplyChainEvent": {
              "ram:OccurrenceDateTime": dateTime(invoice.delivery.date),
            },
          }),
          ...(invoice.despatchReference && {
            "ram:DespatchAdviceReferencedDocument": {
              "ram:IssuerAssignedID": invoice.despatchReference,
            },
          }),
        },
        "ram:ApplicableHeaderTradeSettlement": {
          ...(paymentReferences.length > 0 && {
            "ram:PaymentReference": paymentReferences,
          }),
          "ram:InvoiceCurrencyCode": invoice.currency,
          ...(invoice.paymentMeans && {
            "ram:SpecifiedTradeSettlementPaymentMeans": invoice.paymentMeans.map((payment) => ({
              "ram:TypeCode": getPaymentCodeByKey(payment.paymentMethod),
              ...(payment.name && { "ram:Information": payment.name }),
              ...(payment.reference && { "ram:ID": payment.reference }),
              "ram:PayeePartyCreditorFinancialAccount": {
                "ram:IBANID": payment.iban,
                ...(payment.name && { "ram:AccountName": payment.name }),
              },
              ...(payment.financialInstitutionBranch && {
                "ram:PayeeSpecifiedCreditorFinancialInstitution": {
                  "ram:BICID": payment.financialInstitutionBranch,
                },
              }),
            })),
          }),
          "ram:ApplicableTradeTax": vat.subtotals.map((subtotal) =>
            tradeTax({
              category: subtotal.category,
              percentage: subtotal.percentage,
              currency: invoice.currency,
              calculatedAmount: subtotal.vatAmount,
              basisAmount: subtotal.taxableAmount,
              exemptionReasonCode: subtotal.exemptionReasonCode,
              exemptionReason: subtotal.exemptionReason,
            })
          ),
          ...((invoice.discounts || invoice.surcharges) && {
            "ram:SpecifiedTradeAllowanceCharge": [
              ...(invoice.discounts?.map((discount) =>
                allowanceCharge({
                  isCharge: false,
                  reasonCode: discount.reasonCode,
                  reason: discount.reason,
                  actualAmount: discount.amount,
                  currency: invoice.currency,
                  vat: discount.vat,
                })
              ) || []),
              ...(invoice.surcharges?.map((surcharge) =>
                allowanceCharge({
                  isCharge: true,
                  reasonCode: surcharge.reasonCode,
                  reason: surcharge.reason,
                  actualAmount: surcharge.amount,
                  currency: invoice.currency,
                  vat: surcharge.vat,
                })
              ) || []),
            ],
          }),
          ...(invoice.paymentTerms && {
            "ram:SpecifiedTradePaymentTerms": {
              "ram:Description": invoice.paymentTerms.note,
              ...(invoice.dueDate && { "ram:DueDateDateTime": dateTime(invoice.dueDate) }),
            },
          }),
          ...(!invoice.paymentTerms && invoice.dueDate && {
            "ram:SpecifiedTradePaymentTerms": {
              "ram:DueDateDateTime": dateTime(invoice.dueDate),
            },
          }),
          "ram:SpecifiedTradeSettlementHeaderMonetarySummation": {
            "ram:LineTotalAmount": amount(extractedTotals.linesAmount, invoice.currency),
            ...(extractedTotals.surchargeAmount && {
              "ram:ChargeTotalAmount": amount(extractedTotals.surchargeAmount, invoice.currency),
            }),
            ...(extractedTotals.discountAmount && {
              "ram:AllowanceTotalAmount": amount(extractedTotals.discountAmount, invoice.currency),
            }),
            "ram:TaxBasisTotalAmount": amount(extractedTotals.taxExclusiveAmount, invoice.currency),
            "ram:TaxTotalAmount": currencyAmount(vat.totalVatAmount, invoice.currency),
            "ram:RoundingAmount": amount(extractedTotals.payableRoundingAmount, invoice.currency),
            "ram:GrandTotalAmount": amount(extractedTotals.taxInclusiveAmount, invoice.currency),
            "ram:TotalPrepaidAmount": amount(extractedTotals.paidAmount, invoice.currency),
            "ram:DuePayableAmount": amount(extractedTotals.payableAmount, invoice.currency),
          },
        },
      },
    },
  };
}
