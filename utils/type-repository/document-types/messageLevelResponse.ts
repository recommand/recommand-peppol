import { formatISO } from "date-fns";
import { renderMessageLevelResponse } from "@peppol/utils/document-renderer";
import {
  messageLevelResponseSchema,
  sendMessageLevelResponseSchema,
} from "@peppol/utils/parsing/message-level-response/schemas";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";

export const messageLevelResponseDocumentType: DocumentType<
  typeof sendMessageLevelResponseSchema,
  typeof messageLevelResponseSchema
> = {
  key: "messageLevelResponse",
  translatableTitle: getDocumentTypeTitle("messageLevelResponse"),
  class: "transactionMessaging",
  sendSchema: sendMessageLevelResponseSchema,
  documentSchema: messageLevelResponseSchema,

  preprocessFromSendAPI: (data) => {
    const messageLevelResponse = sendMessageLevelResponseSchema.parse(
      data.document
    );
    return {
      ...messageLevelResponse,
      // The endpoint tests falsiness, and `z.string().optional()` does accept "",
      // so `||` rather than `??` is what reproduces it.
      id: messageLevelResponse.id || Bun.randomUUIDv7(),
      issueDate:
        messageLevelResponse.issueDate ??
        formatISO(new Date(), { representation: "date" }),
    };
  },

  render: (document, options, context) =>
    renderMessageLevelResponse(document, options, {
      documentId: context.documentId,
      type: "messageLevelResponse",
      documentTypeTitle: messageLevelResponseDocumentType.translatableTitle,
    }),

  generateFilename: () => "document",

  pdfGeneration: undefined,

  email: {
    isEmailDeliverySupported: false,
    areEmailNotificationsSupported: true,
    extractDocumentDetails: (document) => {
      const { senderName, receiverName } =
        messageLevelResponseDocumentType.extractCounterparties(document);
      return {
        documentNumber:
          messageLevelResponseDocumentType.extractDocumentNumber(document) ??
          undefined,
        amount: undefined,
        currency: undefined,
        senderName: senderName ?? undefined,
        receiverName: receiverName ?? undefined,
      };
    },
  },

  extractCounterparties: () => ({
    senderName: null,
    receiverName: null,
  }),

  extractSearchableText: () => "",

  extractDocumentNumber: () => null,
};

export default messageLevelResponseDocumentType;
