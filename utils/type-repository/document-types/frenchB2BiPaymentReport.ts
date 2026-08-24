import { renderFranceB2BiReport } from "@peppol/utils/document-renderer";
import { frenchB2BiPaymentReportSchema } from "@peppol/utils/parsing/b2bi-reporting/france";
import type { DocumentType } from "./types";
import { FRENCH_TAX_ADMINISTRATION_NAME } from "./constants";
import { normalize } from "./normalize";

export const frenchB2BiPaymentReportDocumentType: DocumentType<
  typeof frenchB2BiPaymentReportSchema,
  typeof frenchB2BiPaymentReportSchema
> = {
  key: "frenchB2BiPaymentReport",
  translatableTitle: "French Cross-Border Payment Report",
  class: "reporting",
  sendSchema: frenchB2BiPaymentReportSchema,
  documentSchema: frenchB2BiPaymentReportSchema,

  preprocessFromSendAPI: (data) =>
    frenchB2BiPaymentReportSchema.parse(data.document),

  render: (document, options, context) =>
    renderFranceB2BiReport(document, options, {
      documentId: context.documentId,
      type: "frenchB2BiPaymentReport",
      documentTypeTitle: frenchB2BiPaymentReportDocumentType.translatableTitle,
    }),

  generateFilename: (document) =>
    "reference" in document
      ? `french-cross-border-payment-report-${document.reference}`
      : "document",

  pdfGeneration: undefined,

  email: {
    isEmailDeliverySupported: false,
    areEmailNotificationsSupported: true,
    extractDocumentDetails: (document) => ({
      documentNumber:
        frenchB2BiPaymentReportDocumentType.extractDocumentNumber(document) ??
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

  extractSearchableText: (document) =>
    [
      frenchB2BiPaymentReportDocumentType.extractDocumentNumber(document),
      normalize(document.invoiceNumber),
    ]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" "),

  extractDocumentNumber: (document) => normalize(document.reference),
};

export default frenchB2BiPaymentReportDocumentType;
