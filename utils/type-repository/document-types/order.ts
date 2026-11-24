import { formatISO } from "date-fns";
import { renderOrder } from "@peppol/utils/operational-document-renderer";
import { orderSchema, sendOrderSchema } from "@peppol/utils/parsing/order/schemas";
import { calculateOrderAmounts } from "@peppol/utils/parsing/order/calculations";
import { checkOrderConsistency } from "@peppol/utils/parsing/order/consistency";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";
import { withGeneratedAttachment } from "./attachments";
import { reconcileBaseQuantities, unprintedTotalIssues, vatCategoryIssues } from "./billing-intake";
import { negativeQuantityIssues } from "./intake-helpers";

// How AI intake reads an order from a PDF. The buyer issues it, and prices, VAT and
// totals are optional: the checks of the amounts apply only to what the order states.
const ORDER_INSTRUCTIONS = [
  "The buyer issues the order. Put the party that orders in buyer, and the party that the order is placed with, which supplies the goods or services, in seller. The company that received the document is usually the seller.",
  "Put the order number of the buyer in orderNumber. Put the number of a quotation of the seller in quotationReference, and the order number of the seller, when the order repeats it, in salesOrderReference.",
  "Leave orderType out, unless the order says that it is a blanket, call-off, consignment or cross-docking order.",
  "Copy only the prices that the order prints. Leave netPriceAmount, netAmount, discounts and surcharges out of a line without a printed price, and leave totals and vat out when the order prints no totals. When a line prints only its amount, derive netPriceAmount from the amount and the quantity, and add an uncertain_value finding.",
  "Prices and amounts are without VAT. Write the vat of a line only when the order prints a VAT rate or category for it. Write vat.totalVatAmount only when the order prints a VAT total.",
  "Put the requested delivery date of the order in delivery.requestedPeriod: one date as both startDate and endDate, and a latest date as endDate. Put a delivery date of a line in its requestedDeliveryPeriod only when it differs from the date of the order.",
  "Put the delivery address in delivery.location, and the name of the party or place that receives the goods in delivery.recipientName. The delivery address is often not the address of the buyer.",
  "Put delivery terms in deliveryTerms: an Incoterms code such as EXW, FCA or DAP in code, its named place in location, and other delivery terms as text in specialTerms.",
  "An order has no payment means. Copy printed payment terms, such as \"30 days end of month\", into paymentTerms.note.",
  "Put the article number of the seller in sellersId, the article number of the buyer in buyersId, and a GTIN or EAN in standardId with scheme 0160.",
];

export const orderDocumentType: DocumentType<typeof sendOrderSchema, typeof orderSchema> = {
  key: "order",
  translatableTitle: getDocumentTypeTitle("order"),
  class: "operational",
  aiIntake: {
    classification:
      "The buyer orders goods or services from the seller: a purchase order, \"bestelbon\", \"bon de commande\" or \"Bestellung\". It asks for a delivery and does not ask for payment. Not an order confirmation, which the seller sends to the buyer.",
    instructions: ORDER_INSTRUCTIONS,
    reconcile: reconcileBaseQuantities,
    issues: (document, context) => [
      ...vatCategoryIssues(document),
      ...unprintedTotalIssues(document, context.text),
      ...negativeQuantityIssues(document, ["quantity"]),
    ],
  },
  sendSchema: sendOrderSchema,
  documentSchema: orderSchema,

  preprocessFromSendAPI: (data, { company }) => {
    const order = sendOrderSchema.parse(data.document);
    const preprocessed = {
      ...order,
      issueDate: order.issueDate ?? formatISO(new Date(), { representation: "date" }),
      // The buyer places the order, so it is the party defaulted from the company.
      buyer: order.buyer ?? {
        vatNumber: company.vatNumber,
        enterpriseNumberScheme: company.enterpriseNumberScheme,
        enterpriseNumber: company.enterpriseNumber,
        name: company.name,
        street: company.address,
        city: company.city,
        postalZone: company.postalCode,
        country: company.country,
        email: company.email || null,
        phone: company.phone || null,
      },
    };
    const { lines, totals, vat } = calculateOrderAmounts(preprocessed);
    const { payableRoundingAmount: _rounding, ...storedTotals } = totals ?? {
      payableRoundingAmount: null,
    };
    return {
      ...preprocessed,
      lines,
      totals: totals ? storedTotals : null,
      vat,
    };
  },

  render: (document, options, context) =>
    renderOrder(document, options, {
      documentId: context.documentId,
      type: "order",
      documentTypeTitle: orderDocumentType.translatableTitle,
    }),

  generateFilename: (document) => `order-${document.orderNumber}`,

  pdfGeneration: {
    attachGeneratedPdf: (document, attachment) => ({
      ...document,
      attachments: withGeneratedAttachment(document.attachments, attachment),
    }),
  },

  email: {
    isEmailDeliverySupported: true,
    areEmailNotificationsSupported: true,
    extractDocumentDetails: (document) => {
      const { senderName, receiverName } = orderDocumentType.extractCounterparties(document);
      return {
        documentNumber: orderDocumentType.extractDocumentNumber(document) ?? undefined,
        amount: document.totals?.payableAmount ?? undefined,
        currency: document.totals ? document.currency : undefined,
        senderName: senderName ?? undefined,
        senderEmail: normalize(document.buyer?.email) ?? undefined,
        receiverName: receiverName ?? undefined,
        receiverRole: "seller",
        receiverAddressable: document.seller,
      };
    },
  },

  // The buyer issues an order, and the seller receives it.
  extractCounterparties: (document) => ({
    senderName: normalize(document.buyer?.name),
    receiverName: normalize(document.seller?.name),
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } = orderDocumentType.extractCounterparties(document);
    return [senderName, receiverName, document.orderNumber, document.salesOrderReference]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.orderNumber),

  checkConsistency: checkOrderConsistency,
};

export default orderDocumentType;
