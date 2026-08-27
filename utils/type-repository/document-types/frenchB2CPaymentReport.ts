import { renderFranceB2CReport } from "@peppol/utils/document-renderer";
import { frenchB2CPaymentsReportSchema } from "@peppol/utils/parsing/b2c-reporting/france";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";
import { FRENCH_TAX_ADMINISTRATION_NAME } from "./constants";
import { normalize } from "./normalize";

export const frenchB2CPaymentReportDocumentType: DocumentType<
  typeof frenchB2CPaymentsReportSchema,
  typeof frenchB2CPaymentsReportSchema
> = {
  key: "frenchB2CPaymentReport",
  translatableTitle: getDocumentTypeTitle("frenchB2CPaymentReport"),
  class: "reporting",
  sendSchema: frenchB2CPaymentsReportSchema,
  documentSchema: frenchB2CPaymentsReportSchema,

  preprocessFromSendAPI: (data) =>
    frenchB2CPaymentsReportSchema.parse(data.document),

  render: (document, options, context) =>
    renderFranceB2CReport(document, options, {
      documentId: context.documentId,
      type: "frenchB2CPaymentReport",
      documentTypeTitle: frenchB2CPaymentReportDocumentType.translatableTitle,
    }),

  generateFilename: (document) =>
    "reference" in document
      ? `french-b2c-payment-report-${document.reference}`
      : "document",

  pdfGeneration: undefined,

  email: {
    isEmailDeliverySupported: false,
    areEmailNotificationsSupported: true,
    extractDocumentDetails: (document) => ({
      documentNumber:
        frenchB2CPaymentReportDocumentType.extractDocumentNumber(document) ??
        undefined,
      amount: undefined,
      currency: undefined,
      receiverName: FRENCH_TAX_ADMINISTRATION_NAME,
    }),
  },

  extractCounterparties: () => ({
    senderName: null,
    receiverName: null,
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } =
      frenchB2CPaymentReportDocumentType.extractCounterparties(document);
    return [
      senderName,
      receiverName,
      frenchB2CPaymentReportDocumentType.extractDocumentNumber(document),
    ]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.reference),
};

export default frenchB2CPaymentReportDocumentType;
