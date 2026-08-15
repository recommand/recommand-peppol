import { XMLBuilder } from "fast-xml-parser";
import type { CreditNote } from "../schemas";
import { calculateDocumentTotals } from "../../invoice/calculations";
import { parsePeppolAddress } from "../../peppol-address";
import { getPaymentCodeByKey } from "@peppol/utils/payment-means";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

export function creditNoteToUBL(
  {
    creditNote,
    senderAddress,
    recipientAddress,
    isDocumentValidationEnforced,
    profile,
  }: {
    creditNote: CreditNote;
    senderAddress: string;
    recipientAddress: string;
    isDocumentValidationEnforced: boolean;
    profile: XmlProfile;
  }): string {
  const ublCreditNote = prebuildCreditNoteUBL({
    creditNote,
    supplierAddress: senderAddress,
    customerAddress: recipientAddress,
    isDocumentValidationEnforced,
    profile,
  });
  return builder.build(ublCreditNote);
}

export function prebuildCreditNoteUBL({
  creditNote,
  supplierAddress,
  customerAddress,
  isDocumentValidationEnforced,
  profile,
}: {
  creditNote: CreditNote;
  supplierAddress: string;
  customerAddress: string;
  isDocumentValidationEnforced: boolean;
  profile: XmlProfile;
}) {
  const { vat, lines, extractedTotals } = calculateDocumentTotals({
    document: creditNote,
    isDocumentValidationEnforced,
  });

  const supplier = parsePeppolAddress(supplierAddress);
  const buyer = parsePeppolAddress(customerAddress);
  return {
    CreditNote: {
      "@_xmlns": "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
      "@_xmlns:cac":
        "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "@_xmlns:cbc":
        "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      "@_xmlns:ext":
        "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
      "@_xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
      "cbc:CustomizationID": profile.customizationId,
      "cbc:ProfileID": profile.processId,
      "cbc:ID": creditNote.creditNoteNumber,
      "cbc:IssueDate": creditNote.issueDate,
      "cbc:CreditNoteTypeCode": "381",
      ...(creditNote.note && { "cbc:Note": creditNote.note }),
      "cbc:DocumentCurrencyCode": creditNote.currency,
      ...(creditNote.buyerReference && {
        "cbc:BuyerReference": creditNote.buyerReference,
      }),
      ...((creditNote.purchaseOrderReference || creditNote.salesOrderReference) && {
        "cac:OrderReference": {
          "cbc:ID": creditNote.purchaseOrderReference || "NA",
          ...(creditNote.salesOrderReference && { "cbc:SalesOrderID": creditNote.salesOrderReference }),
        },
      }),
      ...(!creditNote.buyerReference &&
        !creditNote.purchaseOrderReference && {
        "cbc:BuyerReference": creditNote.creditNoteNumber,
      }),
      ...(creditNote.despatchReference && {
        "cac:DespatchDocumentReference": {
          "cbc:ID": creditNote.despatchReference,
        },
      }),
      ...(creditNote.invoiceReferences && {
        "cac:BillingReference": creditNote.invoiceReferences.map((reference) => ({
          "cac:InvoiceDocumentReference": {
            "cbc:ID": reference.id,
            ...(reference.issueDate && { "cbc:IssueDate": reference.issueDate }),
          }
        })),
      }),
      ...(creditNote.attachments && {
        "cac:AdditionalDocumentReference": creditNote.attachments.map(
          (attachment) => ({
            "cbc:ID": attachment.id,
            ...(attachment.description && {"cbc:DocumentDescription": attachment.description}),
            ...((attachment.embeddedDocument || attachment.url) && {
              "cac:Attachment": {
                ...(attachment.embeddedDocument && {
                  "cbc:EmbeddedDocumentBinaryObject": {
                    "@_mimeCode": attachment.mimeCode,
                    "@_filename": attachment.filename,
                    "#text": attachment.embeddedDocument,
                  },
                }),
                ...(attachment.url && {
                  "cac:ExternalReference": {
                    "cbc:URI": attachment.url,
                  },
                }),
              },
            }),
          })
        ),
      }),
      "cac:AccountingSupplierParty": {
        "cac:Party": {
          "cbc:EndpointID": {
            "@_schemeID": supplier.schemeId,
            "#text": supplier.identifier,
          },
          "cac:PartyName": {
            "cbc:Name": creditNote.seller.name,
          },
          "cac:PostalAddress": {
            "cbc:StreetName": creditNote.seller.street,
            ...(creditNote.seller.street2 && {
              "cbc:AdditionalStreetName": creditNote.seller.street2,
            }),
            "cbc:CityName": creditNote.seller.city,
            "cbc:PostalZone": creditNote.seller.postalZone,
            "cac:Country": {
              "cbc:IdentificationCode": creditNote.seller.country,
            },
          },
          ...(creditNote.seller.vatNumber && {
            "cac:PartyTaxScheme": {
              "cbc:CompanyID": creditNote.seller.vatNumber,
              "cac:TaxScheme": {
                "cbc:ID": "VAT",
              },
            },
          }),
          "cac:PartyLegalEntity": {
            "cbc:RegistrationName": creditNote.seller.name,
            ...(creditNote.seller.enterpriseNumber && { "cbc:CompanyID": {
              ...(creditNote.seller.enterpriseNumberScheme && { "@_schemeID": creditNote.seller.enterpriseNumberScheme }),
              "#text": creditNote.seller.enterpriseNumber,
            } }),
          },
          "cac:Contact": {
            "cbc:Name": creditNote.seller.name,
            ...(creditNote.seller.phone && { "cbc:Telephone": creditNote.seller.phone }),
            ...(creditNote.seller.email && { "cbc:ElectronicMail": creditNote.seller.email }),
          },
        },
      },
      "cac:AccountingCustomerParty": {
        "cac:Party": {
          "cbc:EndpointID": {
            "@_schemeID": buyer.schemeId,
            "#text": buyer.identifier,
          },
          "cac:PartyName": {
            "cbc:Name": creditNote.buyer.name,
          },
          "cac:PostalAddress": {
            "cbc:StreetName": creditNote.buyer.street,
            ...(creditNote.buyer.street2 && {
              "cbc:AdditionalStreetName": creditNote.buyer.street2,
            }),
            "cbc:CityName": creditNote.buyer.city,
            "cbc:PostalZone": creditNote.buyer.postalZone,
            "cac:Country": {
              "cbc:IdentificationCode": creditNote.buyer.country,
            },
          },
          ...(creditNote.buyer.vatNumber && {
            "cac:PartyTaxScheme": {
              "cbc:CompanyID": creditNote.buyer.vatNumber,
              "cac:TaxScheme": {
                "cbc:ID": "VAT",
              },
            },
          }),
          "cac:PartyLegalEntity": {
            "cbc:RegistrationName": creditNote.buyer.name,
            ...(creditNote.buyer.enterpriseNumber && { "cbc:CompanyID": {
              ...(creditNote.buyer.enterpriseNumberScheme && { "@_schemeID": creditNote.buyer.enterpriseNumberScheme }),
              "#text": creditNote.buyer.enterpriseNumber,
            } }),
          },
          "cac:Contact": {
            "cbc:Name": creditNote.buyer.name,
            ...(creditNote.buyer.phone && { "cbc:Telephone": creditNote.buyer.phone }),
            ...(creditNote.buyer.email && { "cbc:ElectronicMail": creditNote.buyer.email }),
          },
        },
      },
      ...(creditNote.delivery && {
        "cac:Delivery": {
          ...(creditNote.delivery.date && { "cbc:ActualDeliveryDate": creditNote.delivery.date }),
          ...(creditNote.delivery.location && {
            "cac:DeliveryLocation": {
              ...(creditNote.delivery.locationIdentifier && { "cbc:ID": {
                "@_schemeID": creditNote.delivery.locationIdentifier.scheme,
                "#text": creditNote.delivery.locationIdentifier.identifier,
              }}),
              ...(creditNote.delivery.location && { "cac:Address": {
                ...(creditNote.delivery.location.street && { "cbc:StreetName": creditNote.delivery.location.street }),
                ...(creditNote.delivery.location.street2 && { "cbc:AdditionalStreetName": creditNote.delivery.location.street2 }),
                ...(creditNote.delivery.location.city && { "cbc:CityName": creditNote.delivery.location.city }),
                ...(creditNote.delivery.location.postalZone && { "cbc:PostalZone": creditNote.delivery.location.postalZone }),
                "cac:Country": {
                  "cbc:IdentificationCode": creditNote.delivery.location.country,
                },
              }}),
            },
          }),
          ...(creditNote.delivery.recipientName && {
            "cac:DeliveryParty": {
              "cac:PartyName": {
                "cbc:Name": creditNote.delivery.recipientName,
              },
            },
          }),
        },
      }),
      ...(creditNote.paymentMeans && {
        "cac:PaymentMeans": creditNote.paymentMeans.map((payment) => ({
          "cbc:PaymentMeansCode": {
            "#text": getPaymentCodeByKey(payment.paymentMethod),
          },
          ...(payment.reference && {
            "cbc:PaymentID": {
              "#text": payment.reference,
            },
          }),
          "cac:PayeeFinancialAccount": {
            "cbc:ID": {
              "#text": payment.iban,
            },
            ...(payment.name && {
              "cbc:Name": payment.name,
            }),
            ...(payment.financialInstitutionBranch && {
              "cac:FinancialInstitutionBranch": {
                "cbc:ID": payment.financialInstitutionBranch,
              },
            }),
          },
        })),
      }),
      ...(creditNote.paymentTerms && {
        "cac:PaymentTerms": {
          "cbc:Note": creditNote.paymentTerms.note,
        },
      }),
      ...((creditNote.discounts || creditNote.surcharges) && {
        "cac:AllowanceCharge": [
          ...(creditNote.discounts && creditNote.discounts.map((discount) => ({
            "cbc:ChargeIndicator": "false",
            ...(discount.reasonCode && { "cbc:AllowanceChargeReasonCode": discount.reasonCode }),
            ...(discount.reason && { "cbc:AllowanceChargeReason": discount.reason }),
            "cbc:Amount": {
              "@_currencyID": creditNote.currency,
              "#text": discount.amount,
            },
            "cac:TaxCategory": {
              "cbc:ID": discount.vat.category,
              // BR-O-06: A Document level allowance (BG-20) where VAT category code (BT-95) is "Not subject to VAT" shall not contain a Document level allowance VAT rate (BT-96).
              ...(discount.vat.category !== "O" && { "cbc:Percent": discount.vat.percentage }),
              "cac:TaxScheme": {
                "cbc:ID": "VAT",
              },
            },
          })) || []),
          ...(creditNote.surcharges && creditNote.surcharges.map((surcharge) => ({
            "cbc:ChargeIndicator": "true",
            ...(surcharge.reasonCode && { "cbc:AllowanceChargeReasonCode": surcharge.reasonCode }),
            ...(surcharge.reason && { "cbc:AllowanceChargeReason": surcharge.reason }),
            "cbc:Amount": {
              "@_currencyID": creditNote.currency,
              "#text": surcharge.amount,
            },
            "cac:TaxCategory": {
              "cbc:ID": surcharge.vat.category,
              // BR-O-07: A Document level charge (BG-21) where the VAT category code (BT-102) is "Not subject to VAT" shall not contain a Document level charge VAT rate (BT-103).
              ...(surcharge.vat.category !== "O" && { "cbc:Percent": surcharge.vat.percentage }),
              "cac:TaxScheme": {
                "cbc:ID": "VAT",
              },
            },
          })) || []),
        ],
      }),
      "cac:TaxTotal": {
        "cbc:TaxAmount": {
          "@_currencyID": creditNote.currency,
          "#text": vat.totalVatAmount,
        },
        "cac:TaxSubtotal": vat.subtotals.map((subtotal) => ({
          "cbc:TaxableAmount": {
            "@_currencyID": creditNote.currency,
            "#text": subtotal.taxableAmount,
          },
          "cbc:TaxAmount": {
            "@_currencyID": creditNote.currency,
            "#text": subtotal.vatAmount,
          },
          "cac:TaxCategory": {
            "cbc:ID": subtotal.category,
            "cbc:Percent": subtotal.percentage,
            ...(subtotal.exemptionReasonCode && {
              "cbc:TaxExemptionReasonCode": subtotal.exemptionReasonCode,
            }),
            ...(subtotal.exemptionReason && {
              "cbc:TaxExemptionReason": subtotal.exemptionReason,
            }),
            "cac:TaxScheme": {
              "cbc:ID": "VAT",
            },
          },
        })),
      },
      "cac:LegalMonetaryTotal": {
        "cbc:LineExtensionAmount": {
          "@_currencyID": creditNote.currency,
          "#text": extractedTotals.linesAmount,
        },
        "cbc:TaxExclusiveAmount": {
          "@_currencyID": creditNote.currency,
          "#text": extractedTotals.taxExclusiveAmount,
        },
        "cbc:TaxInclusiveAmount": {
          "@_currencyID": creditNote.currency,
          "#text": extractedTotals.taxInclusiveAmount,
        },
        ...(extractedTotals.discountAmount && {
          "cbc:AllowanceTotalAmount": {
          "@_currencyID": creditNote.currency,
          "#text": extractedTotals.discountAmount,
        },
        }),
        ...(extractedTotals.surchargeAmount && {
          "cbc:ChargeTotalAmount": {
            "@_currencyID": creditNote.currency,
            "#text": extractedTotals.surchargeAmount,
          },
        }),
        "cbc:PrepaidAmount": {
          "@_currencyID": creditNote.currency,
          "#text": extractedTotals.paidAmount,
        },
        "cbc:PayableRoundingAmount": {
          "@_currencyID": creditNote.currency,
          "#text": extractedTotals.payableRoundingAmount,
        },
        "cbc:PayableAmount": {
          "@_currencyID": creditNote.currency,
          "#text": extractedTotals.payableAmount,
        },
      },
      "cac:CreditNoteLine": lines.map((item, index) => ({
        "cbc:ID": item.id === undefined || item.id === null ? (index + 1).toString() : item.id,
        ...(item.note && { "cbc:Note": item.note }),
        "cbc:CreditedQuantity": {
          "@_unitCode": item.unitCode,
          "#text": item.quantity,
        },
        "cbc:LineExtensionAmount": {
          "@_currencyID": creditNote.currency,
          "#text": item.netAmount,
        },
        ...(item.orderLineReference && {
          "cac:OrderLineReference": {
            "cbc:LineID": item.orderLineReference,
          },
        }),
        ...(item.documentReference && {
          "cac:DocumentReference": {
            "cbc:ID": item.documentReference,
            "cbc:DocumentTypeCode": "130",
          },
        }),
        ...((item.discounts || item.surcharges) && {
          "cac:AllowanceCharge": [
            ...(item.discounts && item.discounts.map((discount) => ({
              "cbc:ChargeIndicator": "false",
              ...(discount.reasonCode && { "cbc:AllowanceChargeReasonCode": discount.reasonCode }),
              ...(discount.reason && { "cbc:AllowanceChargeReason": discount.reason }),
              "cbc:Amount": {
                "@_currencyID": creditNote.currency,
                "#text": discount.amount,
              },
            })) || []),
            ...(item.surcharges && item.surcharges.map((surcharge) => ({
              "cbc:ChargeIndicator": "true",
              ...(surcharge.reasonCode && { "cbc:AllowanceChargeReasonCode": surcharge.reasonCode }),
              ...(surcharge.reason && { "cbc:AllowanceChargeReason": surcharge.reason }),
              "cbc:Amount": {
                "@_currencyID": creditNote.currency,
                "#text": surcharge.amount,
              },
            })) || []),
          ],
        }),
        "cac:Item": {
          ...(item.description && { "cbc:Description": item.description }),
          "cbc:Name": item.name,
          ...(item.buyersId && {
            "cac:BuyersItemIdentification": { "cbc:ID": item.buyersId },
          }),
          ...(item.sellersId && {
            "cac:SellersItemIdentification": { "cbc:ID": item.sellersId },
          }),
          ...(item.standardId && {
            "cac:StandardItemIdentification": {
              "cbc:ID": {
                "@_schemeID": item.standardId.scheme,
                "#text": item.standardId.identifier,
              },
            },
          }),
          ...(item.originCountry && {
            "cac:OriginCountry": {
              "cbc:IdentificationCode": item.originCountry,
            },
          }),
          ...((item.commodityClassifications && item.commodityClassifications.length > 0) && {
            "cac:CommodityClassification": item.commodityClassifications.map((classification) => ({
              "cbc:ItemClassificationCode": {
                "@_listID": classification.scheme,
                ...(classification.schemeVersion && { "@_listVersionID": classification.schemeVersion }),
                "#text": classification.value,
              }
            })),
          }),
          "cac:ClassifiedTaxCategory": {
            "cbc:ID": item.vat.category,
            // An Invoice line (BG-25) where the VAT category code (BT-151) is "Not subject to VAT" shall not contain an Invoiced item VAT rate (BT-152).	
            ...(item.vat.category !== "O" && { "cbc:Percent": item.vat.percentage }),
            "cac:TaxScheme": {
              "cbc:ID": "VAT",
            },
          },
          ...((item.additionalItemProperties && item.additionalItemProperties.length > 0) && {
            "cac:AdditionalItemProperty": item.additionalItemProperties.map((property) => ({
              "cbc:Name": property.name,
              "cbc:Value": property.value,
            })),
          }),
        },
        "cac:Price": {
          "cbc:PriceAmount": {
            "@_currencyID": creditNote.currency,
            "#text": item.netPriceAmount,
          },
          ...(item.baseQuantity && item.baseQuantity !== "1" && {
            "cbc:BaseQuantity": {
              "@_unitCode": item.unitCode,
              "#text": item.baseQuantity,
            },
          }),
        },
      })),
    },
  };

}
