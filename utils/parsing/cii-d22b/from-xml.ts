import { XMLParser } from "fast-xml-parser";
import { getPaymentKeyByCode } from "@peppol/utils/payment-means";
import {
  getNullableNumberContent,
  getNullableTextContent,
  getNumberContent,
  getPercentage,
  getTextContent,
} from "../xml-helpers";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    name === "IncludedSupplyChainTradeLineItem" ||
    name === "SpecifiedTradeAllowanceCharge" ||
    name === "ApplicableTradeTax" ||
    name === "SpecifiedTradeSettlementPaymentMeans" ||
    name === "PaymentReference" ||
    name === "AdditionalReferencedDocument" ||
    name === "ApplicableProductCharacteristic" ||
    name === "DesignatedProductClassification" ||
    name === "InvoiceReferencedDocument",
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
});

function date(value: any): string {
  const text = getTextContent(value?.DateTimeString ?? value);
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return text;
}

function nullableDate(value: any): string | null {
  const parsedDate = date(value);
  return parsedDate || null;
}

function allowanceCharge(charge: any) {
  return {
    reasonCode: getNullableTextContent(charge.ReasonCode),
    reason: getNullableTextContent(charge.Reason),
    amount: getNumberContent(charge.ActualAmount),
  };
}

function documentAllowanceCharge(charge: any) {
  return {
    ...allowanceCharge(charge),
    vat: {
      category: getTextContent(charge.CategoryTradeTax?.CategoryCode),
      percentage: getPercentage(charge.CategoryTradeTax?.RateApplicablePercent),
    },
  };
}

function isCharge(charge: any): boolean {
  return getTextContent(charge.ChargeIndicator?.Indicator) === "true";
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function party(tradeParty: any) {
  return {
    name: getTextContent(tradeParty.Name),
    street: getTextContent(tradeParty.PostalTradeAddress?.LineOne),
    street2: getTextContent(tradeParty.PostalTradeAddress?.LineTwo),
    city: getTextContent(tradeParty.PostalTradeAddress?.CityName),
    postalZone: getTextContent(tradeParty.PostalTradeAddress?.PostcodeCode),
    country: getTextContent(tradeParty.PostalTradeAddress?.CountryID),
    vatNumber: tradeParty.SpecifiedTaxRegistration?.ID
      ? getTextContent(tradeParty.SpecifiedTaxRegistration.ID)
      : null,
    enterpriseNumberScheme: getNullableTextContent(
      tradeParty.SpecifiedLegalOrganization?.ID?.["@_schemeID"]
    ),
    enterpriseNumber: getNullableTextContent(
      tradeParty.SpecifiedLegalOrganization?.ID?.["#text"] ??
        tradeParty.SpecifiedLegalOrganization?.ID
    ),
    email: getNullableTextContent(
      tradeParty.DefinedTradeContact?.EmailURIUniversalCommunication?.URIID
    ),
    phone: getNullableTextContent(
      tradeParty.DefinedTradeContact?.TelephoneUniversalCommunication?.CompleteNumber
    ),
  };
}

function attachment(ref: any) {
  return {
    id: getTextContent(ref.IssuerAssignedID),
    description: getTextContent(ref.Name),
    mimeCode: getTextContent(ref.AttachmentBinaryObject?.["@_mimeCode"]),
    filename: getTextContent(ref.AttachmentBinaryObject?.["@_filename"]),
    embeddedDocument: getTextContent(ref.AttachmentBinaryObject?.["#text"]),
    url: getTextContent(ref.URIID),
  };
}

export function parseBillingDocumentFromCII(xml: string) {
  const parsed = parser.parse(xml);
  const invoice = parsed.CrossIndustryInvoice;

  if (!invoice) {
    throw new Error("Invalid XML: No CrossIndustryInvoice element found");
  }

  const transaction = invoice.SupplyChainTradeTransaction;
  if (!transaction) {
    throw new Error("Invalid XML: No supply chain trade transaction found");
  }

  const agreement = transaction.ApplicableHeaderTradeAgreement;
  const delivery = transaction.ApplicableHeaderTradeDelivery;
  const settlement = transaction.ApplicableHeaderTradeSettlement;
  const monetarySummation = settlement?.SpecifiedTradeSettlementHeaderMonetarySummation;

  if (!agreement?.SellerTradeParty || !agreement?.BuyerTradeParty) {
    throw new Error("Invalid XML: Missing seller or buyer trade party");
  }

  if (!settlement || !monetarySummation) {
    throw new Error("Invalid XML: Missing settlement information");
  }

  const headerAllowanceCharges = settlement.SpecifiedTradeAllowanceCharge || [];
  const tradeTaxes = settlement.ApplicableTradeTax || [];
  const headerReferences = agreement.AdditionalReferencedDocument || [];
  const paymentReferences = settlement.PaymentReference || [];
  const shipToTradeParty = delivery?.ShipToTradeParty;
  const deliveryLocationIdentifier =
    shipToTradeParty?.GlobalID ?? shipToTradeParty?.ID;
  const deliveryDate = nullableDate(
    delivery?.ActualDeliverySupplyChainEvent?.OccurrenceDateTime
  );
  const paymentTerms = settlement.SpecifiedTradePaymentTerms?.Description
    ? { note: getTextContent(settlement.SpecifiedTradePaymentTerms.Description) }
    : undefined;

  return {
    documentNumber: getTextContent(invoice.ExchangedDocument?.ID),
    typeCode: getTextContent(invoice.ExchangedDocument?.TypeCode),
    issueDate: date(invoice.ExchangedDocument?.IssueDateTime),
    dueDate: nullableDate(settlement.SpecifiedTradePaymentTerms?.DueDateDateTime),
    note: getTextContent(invoice.ExchangedDocument?.IncludedNote?.Content),
    purchaseOrderReference: getNullableTextContent(
      agreement.BuyerOrderReferencedDocument?.IssuerAssignedID
    ),
    salesOrderReference: getNullableTextContent(
      agreement.SellerOrderReferencedDocument?.IssuerAssignedID
    ),
    buyerReference: getNullableTextContent(agreement.BuyerReference),
    despatchReference: getNullableTextContent(
      delivery?.DespatchAdviceReferencedDocument?.IssuerAssignedID
    ),
    invoiceReferences: (settlement.InvoiceReferencedDocument || []).map((reference: any) => ({
      id: getTextContent(reference.IssuerAssignedID),
      issueDate: nullableDate(reference.FormattedIssueDateTime),
    })),
    attachments:
      headerReferences.length > 0
        ? headerReferences
            .filter((ref: any) => getTextContent(ref.TypeCode) === "916")
            .map(attachment)
        : [],
    seller: party(agreement.SellerTradeParty),
    buyer: party(agreement.BuyerTradeParty),
    delivery: shipToTradeParty || deliveryDate
      ? {
          date: deliveryDate,
          locationIdentifier: deliveryLocationIdentifier
            ? {
                scheme: getTextContent(
                  deliveryLocationIdentifier?.["@_schemeID"]
                ),
                identifier: getTextContent(
                  deliveryLocationIdentifier?.["#text"] ??
                    deliveryLocationIdentifier
                ),
              }
            : undefined,
          location: shipToTradeParty?.PostalTradeAddress
            ? {
                street: getNullableTextContent(shipToTradeParty.PostalTradeAddress.LineOne),
                street2: getNullableTextContent(shipToTradeParty.PostalTradeAddress.LineTwo),
                city: getNullableTextContent(shipToTradeParty.PostalTradeAddress.CityName),
                postalZone: getNullableTextContent(
                  shipToTradeParty.PostalTradeAddress.PostcodeCode
                ),
                country: getTextContent(shipToTradeParty.PostalTradeAddress.CountryID),
              }
            : undefined,
          recipientName: getNullableTextContent(shipToTradeParty?.Name) ?? undefined,
        }
      : undefined,
    paymentMeans: (settlement.SpecifiedTradeSettlementPaymentMeans || []).map(
      (payment: any, index: number) => ({
        paymentMethod: getPaymentKeyByCode(getTextContent(payment.TypeCode)),
        reference: getTextContent(paymentReferences[index]),
        iban: getTextContent(payment.PayeePartyCreditorFinancialAccount?.IBANID),
        name: getNullableTextContent(
          payment.PayeePartyCreditorFinancialAccount?.AccountName
        ),
        financialInstitutionBranch: getNullableTextContent(
          payment.PayeeSpecifiedCreditorFinancialInstitution?.BICID
        ),
      })
    ),
    paymentTerms,
    lines: (transaction.IncludedSupplyChainTradeLineItem || []).map((line: any) => {
      const product = line.SpecifiedTradeProduct;
      const lineAgreement = line.SpecifiedLineTradeAgreement;
      const lineDelivery = line.SpecifiedLineTradeDelivery;
      const lineSettlement = line.SpecifiedLineTradeSettlement;
      const lineCharges = lineSettlement?.SpecifiedTradeAllowanceCharge || [];
      const lineTax = first(lineSettlement?.ApplicableTradeTax);
      const lineReference =
        first(lineSettlement?.AdditionalReferencedDocument) ??
        first(lineAgreement?.AdditionalReferencedDocument);

      return {
        id: getTextContent(line.AssociatedDocumentLineDocument?.LineID),
        name: getTextContent(product?.Name),
        description: getTextContent(product?.Description),
        note: getNullableTextContent(
          line.AssociatedDocumentLineDocument?.IncludedNote?.Content
        ),
        buyersId: getNullableTextContent(product?.BuyerAssignedID),
        sellersId: getNullableTextContent(product?.SellerAssignedID),
        standardId: product?.GlobalID
          ? {
              scheme: getTextContent(product.GlobalID["@_schemeID"]),
              identifier: getTextContent(product.GlobalID["#text"] ?? product.GlobalID),
            }
          : null,
        documentReference: getNullableTextContent(
          lineReference?.IssuerAssignedID
        ),
        orderLineReference: getNullableTextContent(
          lineAgreement?.BuyerOrderReferencedDocument?.LineID
        ),
        commodityClassifications: (product?.DesignatedProductClassification || []).map(
          (classification: any) => ({
            scheme: getTextContent(classification.ClassCode?.["@_listID"]),
            schemeVersion: getNullableTextContent(
              classification.ClassCode?.["@_listVersionID"]
            ),
            value: getTextContent(classification.ClassCode?.["#text"]),
          })
        ),
        additionalItemProperties: (product?.ApplicableProductCharacteristic || []).map(
          (property: any) => ({
            name: getTextContent(property.Description),
            value: getTextContent(property.Value),
          })
        ),
        originCountry: getNullableTextContent(product?.OriginTradeCountry?.ID),
        quantity: getNumberContent(lineDelivery?.BilledQuantity),
        unitCode: getTextContent(lineDelivery?.BilledQuantity?.["@_unitCode"]),
        netAmount: getNumberContent(
          lineSettlement?.SpecifiedTradeSettlementLineMonetarySummation?.LineTotalAmount
        ),
        netPriceAmount: getNumberContent(
          lineAgreement?.NetPriceProductTradePrice?.ChargeAmount
        ),
        baseQuantity:
          getNullableNumberContent(
            lineAgreement?.NetPriceProductTradePrice?.BasisQuantity
          ) || "1",
        vat: {
          category: getTextContent(lineTax?.CategoryCode),
          percentage: getPercentage(lineTax?.RateApplicablePercent),
        },
        discounts: lineCharges.filter((charge: any) => !isCharge(charge)).map(allowanceCharge),
        surcharges: lineCharges.filter(isCharge).map(allowanceCharge),
      };
    }),
    vat: {
      totalVatAmount: getNumberContent(monetarySummation.TaxTotalAmount),
      subtotals: tradeTaxes.map((tax: any) => ({
        taxableAmount: getNumberContent(tax.BasisAmount),
        vatAmount: getNumberContent(tax.CalculatedAmount),
        category: getTextContent(tax.CategoryCode),
        percentage: getPercentage(tax.RateApplicablePercent),
        exemptionReasonCode: getNullableTextContent(tax.ExemptionReasonCode),
        exemptionReason: getNullableTextContent(tax.ExemptionReason),
      })),
    },
    discounts: headerAllowanceCharges
      .filter((charge: any) => !isCharge(charge))
      .map(documentAllowanceCharge),
    surcharges: headerAllowanceCharges.filter(isCharge).map(documentAllowanceCharge),
    totals: {
      linesAmount: getNumberContent(monetarySummation.LineTotalAmount),
      discountAmount: getNullableNumberContent(monetarySummation.AllowanceTotalAmount),
      surchargeAmount: getNullableNumberContent(monetarySummation.ChargeTotalAmount),
      taxExclusiveAmount: getNumberContent(monetarySummation.TaxBasisTotalAmount),
      taxInclusiveAmount: getNumberContent(monetarySummation.GrandTotalAmount),
      paidAmount: getNullableNumberContent(monetarySummation.TotalPrepaidAmount),
      payableAmount: getNumberContent(monetarySummation.DuePayableAmount),
    },
    currency: getTextContent(settlement.InvoiceCurrencyCode),
  };
}
