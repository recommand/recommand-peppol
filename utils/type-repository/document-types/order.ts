import { formatISO } from "date-fns";
import { renderOrder } from "@peppol/utils/operational-document-renderer";
import { orderSchema, sendOrderSchema } from "@peppol/utils/parsing/order/schemas";
import { calculateOrderAmounts } from "@peppol/utils/parsing/order/calculations";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";
import { withGeneratedAttachment } from "./attachments";

export const orderDocumentType: DocumentType<typeof sendOrderSchema, typeof orderSchema> = {
  key: "order",
  translatableTitle: getDocumentTypeTitle("order"),
  class: "operational",
  aiIntake: null,
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
};

export default orderDocumentType;
