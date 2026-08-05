import { renderFranceB2CReport } from "@peppol/utils/document-renderer";
import { FRENCH_TAX_ADMINISTRATION_NAME } from "@peppol/utils/document-types";
import { frenchB2CSalesReportSchema } from "@peppol/utils/parsing/b2c-reporting/france";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";

export const frenchB2CSalesReportDocumentType: DocumentType<
  typeof frenchB2CSalesReportSchema,
  typeof frenchB2CSalesReportSchema
> = {
  key: "frenchB2CSalesReport",
  translatableTitle: "French B2C Sales Report",
  class: "reporting",
  sendSchema: frenchB2CSalesReportSchema,
  documentSchema: frenchB2CSalesReportSchema,

  preprocessFromSendAPI: (data) => ({
    ...frenchB2CSalesReportSchema.parse(data.document),
  }),

  render: (document, options, context) =>
    renderFranceB2CReport(document, options, {
      documentId: context.documentId,
      type: "frenchB2CSalesReport",
    }),

  generateFilename: (document) =>
    "reference" in document
      ? `french-b2c-sales-report-${document.reference}`
      : "document",

  pdfGeneration: undefined,

  email: {
    isEmailDeliverySupported: false,
    areEmailNotificationsSupported: true,
    extractDocumentDetails: (document) => ({
      documentNumber:
        frenchB2CSalesReportDocumentType.extractDocumentNumber(document) ??
        undefined,
      amount: document.taxExclusiveAmount,
      currency: document.currency,
      receiverName: FRENCH_TAX_ADMINISTRATION_NAME,
    }),
  },

  extractCounterparties: () => ({
    senderName: null,
    receiverName: null,
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } =
      frenchB2CSalesReportDocumentType.extractCounterparties(document);
    return [
      senderName,
      receiverName,
      frenchB2CSalesReportDocumentType.extractDocumentNumber(document),
    ]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.reference),
};

export default frenchB2CSalesReportDocumentType;
