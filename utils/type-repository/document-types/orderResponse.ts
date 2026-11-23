import { formatISO } from "date-fns";
import { renderOrderResponse } from "@peppol/utils/operational-document-renderer";
import {
  orderResponseSchema,
  sendOrderResponseSchema,
} from "@peppol/utils/parsing/order-response/schemas";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";
import { companyIdentifiers, identifiedParty } from "./party-identifiers";

export const orderResponseDocumentType: DocumentType<
  typeof sendOrderResponseSchema,
  typeof orderResponseSchema
> = {
  key: "orderResponse",
  translatableTitle: getDocumentTypeTitle("orderResponse"),
  class: "operational",
  sendSchema: sendOrderResponseSchema,
  documentSchema: orderResponseSchema,

  preprocessFromSendAPI: (data, { company }) => {
    const response = sendOrderResponseSchema.parse(data.document);
    return {
      ...response,
      issueDate: response.issueDate ?? formatISO(new Date(), { representation: "date" }),
      // The seller answers the order, so it is the party defaulted from the company.
      seller: response.seller ?? {
        name: company.name,
        partyIdentifiers: companyIdentifiers(company),
      },
    };
  },

  render: (document, options, context) =>
    renderOrderResponse(document, options, {
      documentId: context.documentId,
      type: "orderResponse",
      documentTypeTitle: orderResponseDocumentType.translatableTitle,
    }),

  generateFilename: (document) => `order-response-${document.orderResponseNumber}`,

  // An order response carries no attachments to put a generated PDF in.
  pdfGeneration: undefined,

  email: {
    isEmailDeliverySupported: true,
    areEmailNotificationsSupported: true,
    extractDocumentDetails: (document) => {
      const { senderName, receiverName } =
        orderResponseDocumentType.extractCounterparties(document);
      return {
        documentNumber: orderResponseDocumentType.extractDocumentNumber(document) ?? undefined,
        amount: undefined,
        currency: undefined,
        senderName: senderName ?? undefined,
        receiverName: receiverName ?? undefined,
        receiverRole: "buyer",
        receiverAddressable: identifiedParty(document.buyer.partyIdentifiers),
      };
    },
  },

  // The seller answers the order, and the buyer receives the answer.
  extractCounterparties: (document) => ({
    senderName: normalize(document.seller?.name),
    receiverName: normalize(document.buyer?.name),
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } =
      orderResponseDocumentType.extractCounterparties(document);
    return [senderName, receiverName, document.orderResponseNumber, document.orderReference]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.orderResponseNumber),
};

export default orderResponseDocumentType;
