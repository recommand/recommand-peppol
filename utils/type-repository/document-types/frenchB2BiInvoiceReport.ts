import { renderFranceB2BiReport } from "@peppol/utils/document-renderer";
import { frenchB2BiInvoiceReportSchema } from "@peppol/utils/parsing/b2bi-reporting/france";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";
import { FRENCH_TAX_ADMINISTRATION_NAME } from "./constants";
import { normalize } from "./normalize";

export const frenchB2BiInvoiceReportDocumentType: DocumentType<
  typeof frenchB2BiInvoiceReportSchema,
  typeof frenchB2BiInvoiceReportSchema
> = {
  key: "frenchB2BiInvoiceReport",
  translatableTitle: getDocumentTypeTitle("frenchB2BiInvoiceReport"),
  class: "reporting",
  sendSchema: frenchB2BiInvoiceReportSchema,
  documentSchema: frenchB2BiInvoiceReportSchema,

  preprocessFromSendAPI: (data) =>
    frenchB2BiInvoiceReportSchema.parse(data.document),

  render: (document, options, context) =>
    renderFranceB2BiReport(document, options, {
      documentId: context.documentId,
      type: "frenchB2BiInvoiceReport",
      documentTypeTitle: frenchB2BiInvoiceReportDocumentType.translatableTitle,
    }),

  generateFilename: (document) =>
    "reference" in document
      ? `french-cross-border-invoice-report-${document.reference}`
      : "document",

  pdfGeneration: undefined,

  email: {
    isEmailDeliverySupported: false,
    areEmailNotificationsSupported: true,
    extractDocumentDetails: (document) => ({
      documentNumber:
        frenchB2BiInvoiceReportDocumentType.extractDocumentNumber(document) ??
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

  extractSearchableText: (document) =>
    [
      frenchB2BiInvoiceReportDocumentType.extractDocumentNumber(document),
      normalize(document.documentNumber),
      normalize(document.buyer.enterpriseNumber),
      normalize(document.buyer.vatNumber),
    ]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" "),

  extractDocumentNumber: (document) => normalize(document.reference),
};

export default frenchB2BiInvoiceReportDocumentType;
