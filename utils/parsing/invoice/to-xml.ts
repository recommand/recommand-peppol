import { XMLBuilder } from "fast-xml-parser";
import type { Invoice } from "./schemas";
import {
  calculateLineAmount,
  calculateTotals,
  calculateVat,
  extractTotals,
} from "./calculations";
import { parsePeppolAddress } from "../peppol-address";
import { getPaymentCodeByKey } from "@peppol/utils/payment-means";
import { INVOICE_DOCUMENT_TYPE_INFO } from "@peppol/utils/document-types";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

export function invoiceToUBL({
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
  const ublInvoice = prebuildInvoiceUBL({
    invoice,
    supplierAddress: senderAddress,
    customerAddress: recipientAddress,
    isDocumentValidationEnforced,
  });
  return builder.build(ublInvoice);
}

export function prebuildInvoiceUBL({ invoice, supplierAddress, customerAddress, isDocumentValidationEnforced }: { invoice: Invoice, supplierAddress: string, customerAddress: string, isDocumentValidationEnforced: boolean }) {
  const totals = calculateTotals(invoice);
  const vat = (invoice.vat && "subtotals" in invoice.vat && "totalVatAmount" in invoice.vat) ? invoice.vat : calculateVat({ document: invoice, isDocumentValidationEnforced });
  const lines = invoice.lines.map((line) => ({
    ...line,
    netAmount: line.netAmount || calculateLineAmount(line),
  }));

  const extractedTotals = extractTotals(totals);

  const supplier = parsePeppolAddress(supplierAddress);
  const customer = parsePeppolAddress(customerAddress);
  return {
    Invoice: {
      "@_xmlns": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      "@_xmlns:cac":
        "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "@_xmlns:cbc":
        "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      "@_xmlns:ext":
        "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
      "@_xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
      "cbc:CustomizationID":
        "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
      "cbc:ProfileID": INVOICE_DOCUMENT_TYPE_INFO.processId,
      "cbc:ID": invoice.invoiceNumber,
      "cbc:IssueDate": invoice.issueDate,
      "cbc:DueDate": invoice.dueDate,
      "cbc:InvoiceTypeCode": "380",
      ...(invoice.note && { "cbc:Note": invoice.note }),
      "cbc:DocumentCurrencyCode": invoice.currency,
      ...(invoice.buyerReference && {
        "cbc:BuyerReference": invoice.buyerReference,
      }),
      ...((invoice.purchaseOrderReference || invoice.salesOrderReference) && {
        "cac:OrderReference": {
          "cbc:ID": invoice.purchaseOrderReference ? invoice.purchaseOrderReference : "NA",
          ...(invoice.salesOrderReference && { "cbc:SalesOrderID": invoice.salesOrderReference }),
        },
      }),
      ...(!invoice.buyerReference &&
        !invoice.purchaseOrderReference && {
        "cbc:BuyerReference": invoice.invoiceNumber,
      }),
      ...(invoice.despatchReference && {
        "cac:DespatchDocumentReference": {
          "cbc:ID": invoice.despatchReference,
        },
      }),
      ...(invoice.attachments && {
        "cac:AdditionalDocumentReference": invoice.attachments.map(
          (attachment) => ({
            "cbc:ID": attachment.id,
            ...(attachment.description && { "cbc:DocumentDescription": attachment.description }),
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
            "cbc:Name": invoice.seller.name,
          },
          "cac:PostalAddress": {
            "cbc:StreetName": invoice.seller.street,
            ...(invoice.seller.street2 && {
              "cbc:AdditionalStreetName": invoice.seller.street2,
            }),
            "cbc:CityName": invoice.seller.city,
            "cbc:PostalZone": invoice.seller.postalZone,
            "cac:Country": {
              "cbc:IdentificationCode": invoice.seller.country,
            },
          },
          ...(invoice.seller.vatNumber && {
            "cac:PartyTaxScheme": {
              "cbc:CompanyID": invoice.seller.vatNumber,
              "cac:TaxScheme": {
                "cbc:ID": "VAT",
              },
            },
          }),
          "cac:PartyLegalEntity": {
            "cbc:RegistrationName": invoice.seller.name,
            ...(invoice.seller.enterpriseNumber && { "cbc:CompanyID": {
              ...(invoice.seller.enterpriseNumberScheme && { "@_schemeID": invoice.seller.enterpriseNumberScheme }),
              "#text": invoice.seller.enterpriseNumber,
            } }),
          },
          "cac:Contact": {
            "cbc:Name": invoice.seller.name,
            ...(invoice.seller.phone && { "cbc:Telephone": invoice.seller.phone }),
            ...(invoice.seller.email && { "cbc:ElectronicMail": invoice.seller.email }),
          },
        },
      },
      "cac:AccountingCustomerParty": {
        "cac:Party": {
          "cbc:EndpointID": {
            "@_schemeID": customer.schemeId,
            "#text": customer.identifier,
          },
          "cac:PartyName": {
            "cbc:Name": invoice.buyer.name,
          },
          "cac:PostalAddress": {
            "cbc:StreetName": invoice.buyer.street,
            ...(invoice.buyer.street2 && {
              "cbc:AdditionalStreetName": invoice.buyer.street2,
            }),
            "cbc:CityName": invoice.buyer.city,
            "cbc:PostalZone": invoice.buyer.postalZone,
            "cac:Country": {
              "cbc:IdentificationCode": invoice.buyer.country,
            },
          },
          ...(invoice.buyer.vatNumber && {
            "cac:PartyTaxScheme": {
              "cbc:CompanyID": invoice.buyer.vatNumber,
              "cac:TaxScheme": {
                "cbc:ID": "VAT",
              },
            },
          }),
          "cac:PartyLegalEntity": {
            "cbc:RegistrationName": invoice.buyer.name,
            ...(invoice.buyer.enterpriseNumber && { "cbc:CompanyID": {
              ...(invoice.buyer.enterpriseNumberScheme && { "@_schemeID": invoice.buyer.enterpriseNumberScheme }),
              "#text": invoice.buyer.enterpriseNumber,
            } }),
          },
          "cac:Contact": {
            "cbc:Name": invoice.buyer.name,
            ...(invoice.buyer.phone && { "cbc:Telephone": invoice.buyer.phone }),
            ...(invoice.buyer.email && { "cbc:ElectronicMail": invoice.buyer.email }),
          },
        },
      },
      ...(invoice.delivery && {
        "cac:Delivery": {
          ...(invoice.delivery.date && { "cbc:ActualDeliveryDate": invoice.delivery.date }),
          ...(invoice.delivery.location && {
            "cac:DeliveryLocation": {
              ...(invoice.delivery.locationIdentifier && {
                "cbc:ID": {
                  "@_schemeID": invoice.delivery.locationIdentifier.scheme,
                  "#text": invoice.delivery.locationIdentifier.identifier,
                }
              }),
              ...(invoice.delivery.location && {
                "cac:Address": {
                  ...(invoice.delivery.location.street && { "cbc:StreetName": invoice.delivery.location.street }),
                  ...(invoice.delivery.location.street2 && { "cbc:AdditionalStreetName": invoice.delivery.location.street2 }),
                  ...(invoice.delivery.location.city && { "cbc:CityName": invoice.delivery.location.city }),
                  ...(invoice.delivery.location.postalZone && { "cbc:PostalZone": invoice.delivery.location.postalZone }),
                  "cac:Country": {
                    "cbc:IdentificationCode": invoice.delivery.location.country,
                  },
                }
              }),
            },
          }),
          ...(invoice.delivery.recipientName && {
            "cac:DeliveryParty": {
              "cac:PartyName": {
                "cbc:Name": invoice.delivery.recipientName,
              },
            },
          }),
        },
      }),
      ...(invoice.paymentMeans && {
        "cac:PaymentMeans": invoice.paymentMeans.map((payment) => ({
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
      ...(invoice.paymentTerms?.note && {
        "cac:PaymentTerms": {
          "cbc:Note": invoice.paymentTerms!.note,
        },
      }),
      ...((invoice.discounts || invoice.surcharges) && {
        "cac:AllowanceCharge": [
          ...(invoice.discounts && invoice.discounts.map((discount) => ({
            "cbc:ChargeIndicator": "false",
            ...(discount.reasonCode && { "cbc:AllowanceChargeReasonCode": discount.reasonCode }),
            ...(discount.reason && { "cbc:AllowanceChargeReason": discount.reason }),
            "cbc:Amount": {
              "@_currencyID": invoice.currency,
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
          ...(invoice.surcharges && invoice.surcharges.map((surcharge) => ({
            "cbc:ChargeIndicator": "true",
            ...(surcharge.reasonCode && { "cbc:AllowanceChargeReasonCode": surcharge.reasonCode }),
            ...(surcharge.reason && { "cbc:AllowanceChargeReason": surcharge.reason }),
            "cbc:Amount": {
              "@_currencyID": invoice.currency,
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
          "@_currencyID": invoice.currency,
          "#text": vat.totalVatAmount,
        },
        "cac:TaxSubtotal": vat.subtotals.map((subtotal) => ({
          "cbc:TaxableAmount": {
            "@_currencyID": invoice.currency,
            "#text": subtotal.taxableAmount,
          },
          "cbc:TaxAmount": {
            "@_currencyID": invoice.currency,
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
          "@_currencyID": invoice.currency,
          "#text": extractedTotals.linesAmount,
        },
        "cbc:TaxExclusiveAmount": {
          "@_currencyID": invoice.currency,
          "#text": extractedTotals.taxExclusiveAmount,
        },
        "cbc:TaxInclusiveAmount": {
          "@_currencyID": invoice.currency,
          "#text": extractedTotals.taxInclusiveAmount,
        },
        ...(extractedTotals.discountAmount && {
          "cbc:AllowanceTotalAmount": {
            "@_currencyID": invoice.currency,
            "#text": extractedTotals.discountAmount,
          },
        }),
        ...(extractedTotals.surchargeAmount && {
          "cbc:ChargeTotalAmount": {
            "@_currencyID": invoice.currency,
            "#text": extractedTotals.surchargeAmount,
          },
        }),
        "cbc:PrepaidAmount": {
          "@_currencyID": invoice.currency,
          "#text": extractedTotals.paidAmount,
        },
        "cbc:PayableRoundingAmount": {
          "@_currencyID": invoice.currency,
          "#text": extractedTotals.payableRoundingAmount,
        },
        "cbc:PayableAmount": {
          "@_currencyID": invoice.currency,
          "#text": extractedTotals.payableAmount,
        },
      },
      "cac:InvoiceLine": lines.map((item, index) => ({
        "cbc:ID": item.id === undefined || item.id === null ? (index + 1).toString() : item.id,
        ...(item.note && { "cbc:Note": item.note }),
        "cbc:InvoicedQuantity": {
          "@_unitCode": item.unitCode,
          "#text": item.quantity,
        },
        "cbc:LineExtensionAmount": {
          "@_currencyID": invoice.currency,
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
                "@_currencyID": invoice.currency,
                "#text": discount.amount,
              },
            })) || []),
            ...(item.surcharges && item.surcharges.map((surcharge) => ({
              "cbc:ChargeIndicator": "true",
              ...(surcharge.reasonCode && { "cbc:AllowanceChargeReasonCode": surcharge.reasonCode }),
              ...(surcharge.reason && { "cbc:AllowanceChargeReason": surcharge.reason }),
              "cbc:Amount": {
                "@_currencyID": invoice.currency,
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
            "@_currencyID": invoice.currency,
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