import { XMLBuilder } from "fast-xml-parser";
import type { Invoice, Party } from "../invoice/schemas";
import type { CreditNote } from "../creditnote/schemas";
import { calculateDocumentTotals } from "../invoice/calculations";
import { parsePeppolAddress } from "../peppol-address";
import { getPaymentCodeByKey } from "@peppol/utils/payment-means";
import { getCustomizationId, type DocumentTypeInfo } from "@peppol/utils/document-types";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

type XmlNode = Record<string, unknown>;
type BillingDocument = Invoice | CreditNote;

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

export function dateTime(date: string): XmlNode {
  return {
    "udt:DateTimeString": {
      "@_format": "102",
      "#text": date.replaceAll("-", ""),
    },
  };
}

function formattedDateTime(date: string): XmlNode {
  return {
    "qdt:DateTimeString": {
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
    "ram:URIUniversalCommunication": {
      "ram:URIID": id(parsedAddress.identifier, parsedAddress.schemeId),
    },
    ...(party.vatNumber && {
      "ram:SpecifiedTaxRegistration": {
        "ram:ID": id(party.vatNumber, "VA"),
      },
    }),
  };
}

export type CiiIncludedNote = {
  content: string;
  subjectCode?: string;
};

function includedNotes(
  document: BillingDocument,
  additionalNotes: CiiIncludedNote[]
): XmlNode[] | undefined {
  const notes: XmlNode[] = [];
  if (document.note) {
    notes.push({ "ram:Content": document.note });
  }
  notes.push(...additionalNotes.map((note) => ({
    "ram:Content": note.content,
    ...(note.subjectCode && { "ram:SubjectCode": note.subjectCode }),
  })));
  return notes.length > 0 ? notes : undefined;
}

function deliveryTradeParty(document: BillingDocument): XmlNode | undefined {
  if (!document.delivery?.recipientName && !document.delivery?.location && !document.delivery?.locationIdentifier) {
    return undefined;
  }

  return {
    ...(document.delivery?.locationIdentifier && {
      ...(document.delivery.locationIdentifier.scheme
        ? {
            "ram:GlobalID": id(
              document.delivery.locationIdentifier.identifier,
              document.delivery.locationIdentifier.scheme
            ),
          }
        : { "ram:ID": document.delivery.locationIdentifier.identifier }),
    }),
    ...(document.delivery?.recipientName && { "ram:Name": document.delivery.recipientName }),
    ...(document.delivery?.location && {
      "ram:PostalTradeAddress": {
        ...(document.delivery.location.postalZone && {
          "ram:PostcodeCode": document.delivery.location.postalZone,
        }),
        ...(document.delivery.location.street && {
          "ram:LineOne": document.delivery.location.street,
        }),
        ...(document.delivery.location.street2 && {
          "ram:LineTwo": document.delivery.location.street2,
        }),
        ...(document.delivery.location.city && {
          "ram:CityName": document.delivery.location.city,
        }),
        "ram:CountryID": document.delivery.location.country,
      },
    }),
  };
}

function fallbackDeliveryTradeParty(party: Party): XmlNode {
  return {
    "ram:Name": party.name,
    "ram:PostalTradeAddress": tradeAddress(party),
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

function additionalDocumentReference(attachment: NonNullable<BillingDocument["attachments"]>[number]): XmlNode {
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

function lineItem(document: BillingDocument, item: BillingDocument["lines"][number], index: number): XmlNode {
  return {
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
      "ram:NetPriceProductTradePrice": {
        "ram:ChargeAmount": amount(item.netPriceAmount, document.currency),
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
        currency: document.currency,
      }),
      ...((item.discounts || item.surcharges) && {
        "ram:SpecifiedTradeAllowanceCharge": [
          ...(item.discounts?.map((discount) =>
            allowanceCharge({
              isCharge: false,
              reasonCode: discount.reasonCode,
              reason: discount.reason,
              actualAmount: discount.amount,
              currency: document.currency,
            })
          ) || []),
          ...(item.surcharges?.map((surcharge) =>
            allowanceCharge({
              isCharge: true,
              reasonCode: surcharge.reasonCode,
              reason: surcharge.reason,
              actualAmount: surcharge.amount,
              currency: document.currency,
            })
          ) || []),
        ],
      }),
      "ram:SpecifiedTradeSettlementLineMonetarySummation": {
        "ram:LineTotalAmount": amount(item.netAmount, document.currency),
      },
      ...(item.documentReference && {
        "ram:AdditionalReferencedDocument": {
          "ram:IssuerAssignedID": item.documentReference,
          "ram:TypeCode": "130",
        },
      }),
    },
  };
}

export function billingDocumentToCII({
  document,
  documentTypeInfo,
  documentNumber,
  typeCode,
  supplierAddress,
  customerAddress,
  isDocumentValidationEnforced,
  dueDate,
  invoiceReferences,
  businessProcessId = documentTypeInfo.processId,
  additionalNotes = [],
}: {
  document: BillingDocument;
  documentTypeInfo: DocumentTypeInfo;
  documentNumber: string;
  typeCode: "380" | "381";
  supplierAddress: string;
  customerAddress: string;
  isDocumentValidationEnforced: boolean;
  dueDate?: string | null;
  invoiceReferences?: { id: string; issueDate?: string | null }[];
  businessProcessId?: string;
  additionalNotes?: CiiIncludedNote[];
}): string {
  const { vat, lines, extractedTotals } = calculateDocumentTotals({
    document,
    isDocumentValidationEnforced,
  });
  const shipToTradeParty =
    deliveryTradeParty(document) ?? fallbackDeliveryTradeParty(document.buyer);
  const paymentReferences =
    document.paymentMeans
      ?.map((payment) => payment.reference)
      .filter((reference): reference is string => Boolean(reference)) ?? [];
  const documentNotes = includedNotes(document, additionalNotes);

  return builder.build({
    CrossIndustryInvoice: {
      "@_xmlns": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
      "@_xmlns:ram":
        "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
      "@_xmlns:qdt": "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
      "@_xmlns:udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
      ExchangedDocumentContext: {
        "ram:BusinessProcessSpecifiedDocumentContextParameter": {
          "ram:ID": businessProcessId,
        },
        "ram:GuidelineSpecifiedDocumentContextParameter": {
          "ram:ID": documentTypeInfo.ciiGuidelineIdOverride ?? getCustomizationId(documentTypeInfo),
        },
      },
      ExchangedDocument: {
        "ram:ID": documentNumber,
        "ram:TypeCode": typeCode,
        "ram:IssueDateTime": dateTime(document.issueDate),
        ...(documentNotes && {
          "ram:IncludedNote": documentNotes,
        }),
      },
      SupplyChainTradeTransaction: {
        "ram:IncludedSupplyChainTradeLineItem": lines.map((item, index) =>
          lineItem(document, item, index)
        ),
        "ram:ApplicableHeaderTradeAgreement": {
          ...(document.buyerReference && {
            "ram:BuyerReference": document.buyerReference,
          }),
          ...(!document.buyerReference &&
            !document.purchaseOrderReference && {
              "ram:BuyerReference": documentNumber,
            }),
          "ram:SellerTradeParty": tradeParty(document.seller, supplierAddress),
          "ram:BuyerTradeParty": tradeParty(document.buyer, customerAddress),
          ...(document.salesOrderReference && {
            "ram:SellerOrderReferencedDocument": {
              "ram:IssuerAssignedID": document.salesOrderReference,
            },
          }),
          ...(document.purchaseOrderReference && {
            "ram:BuyerOrderReferencedDocument": {
              "ram:IssuerAssignedID": document.purchaseOrderReference,
            },
          }),
          ...(document.attachments && {
            "ram:AdditionalReferencedDocument": document.attachments.map(additionalDocumentReference),
          }),
        },
        "ram:ApplicableHeaderTradeDelivery": {
          ...(shipToTradeParty && { "ram:ShipToTradeParty": shipToTradeParty }),
          ...(document.delivery?.date && {
            "ram:ActualDeliverySupplyChainEvent": {
              "ram:OccurrenceDateTime": dateTime(document.delivery.date),
            },
          }),
          ...(document.despatchReference && {
            "ram:DespatchAdviceReferencedDocument": {
              "ram:IssuerAssignedID": document.despatchReference,
            },
          }),
        },
        "ram:ApplicableHeaderTradeSettlement": {
          ...(paymentReferences.length > 0 && {
            "ram:PaymentReference": paymentReferences,
          }),
          "ram:InvoiceCurrencyCode": document.currency,
          ...(document.paymentMeans && {
            "ram:SpecifiedTradeSettlementPaymentMeans": document.paymentMeans.map((payment) => ({
              "ram:TypeCode": getPaymentCodeByKey(payment.paymentMethod),
              ...(payment.name && { "ram:Information": payment.name }),
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
              currency: document.currency,
              calculatedAmount: subtotal.vatAmount,
              basisAmount: subtotal.taxableAmount,
              exemptionReasonCode: subtotal.exemptionReasonCode,
              exemptionReason: subtotal.exemptionReason,
            })
          ),
          ...((document.discounts || document.surcharges) && {
            "ram:SpecifiedTradeAllowanceCharge": [
              ...(document.discounts?.map((discount) =>
                allowanceCharge({
                  isCharge: false,
                  reasonCode: discount.reasonCode,
                  reason: discount.reason,
                  actualAmount: discount.amount,
                  currency: document.currency,
                  vat: discount.vat,
                })
              ) || []),
              ...(document.surcharges?.map((surcharge) =>
                allowanceCharge({
                  isCharge: true,
                  reasonCode: surcharge.reasonCode,
                  reason: surcharge.reason,
                  actualAmount: surcharge.amount,
                  currency: document.currency,
                  vat: surcharge.vat,
                })
              ) || []),
            ],
          }),
          ...(document.paymentTerms && {
            "ram:SpecifiedTradePaymentTerms": {
              "ram:Description": document.paymentTerms.note,
              ...(dueDate && { "ram:DueDateDateTime": dateTime(dueDate) }),
            },
          }),
          ...(!document.paymentTerms && dueDate && {
            "ram:SpecifiedTradePaymentTerms": {
              "ram:DueDateDateTime": dateTime(dueDate),
            },
          }),
          "ram:SpecifiedTradeSettlementHeaderMonetarySummation": {
            "ram:LineTotalAmount": amount(extractedTotals.linesAmount, document.currency),
            ...(extractedTotals.surchargeAmount && {
              "ram:ChargeTotalAmount": amount(extractedTotals.surchargeAmount, document.currency),
            }),
            ...(extractedTotals.discountAmount && {
              "ram:AllowanceTotalAmount": amount(extractedTotals.discountAmount, document.currency),
            }),
            "ram:TaxBasisTotalAmount": amount(extractedTotals.taxExclusiveAmount, document.currency),
            "ram:TaxTotalAmount": currencyAmount(vat.totalVatAmount, document.currency),
            "ram:RoundingAmount": amount(extractedTotals.payableRoundingAmount, document.currency),
            "ram:GrandTotalAmount": amount(extractedTotals.taxInclusiveAmount, document.currency),
            "ram:TotalPrepaidAmount": amount(extractedTotals.paidAmount, document.currency),
            "ram:DuePayableAmount": amount(extractedTotals.payableAmount, document.currency),
          },
          ...((invoiceReferences && invoiceReferences.length > 0) && {
            "ram:InvoiceReferencedDocument": invoiceReferences.map((reference) => ({
              "ram:IssuerAssignedID": reference.id,
              ...(reference.issueDate && {
                "ram:FormattedIssueDateTime": formattedDateTime(reference.issueDate),
              }),
            })),
          }),
        },
      },
    },
  });
}
