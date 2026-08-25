import { addMonths, formatISO } from "date-fns";
import { renderBillingDocument } from "@peppol/utils/document-renderer";
import {
  invoiceSchema,
  sendInvoiceSchema,
} from "@peppol/utils/parsing/invoice/schemas";
import { resolveVatTotals } from "@peppol/utils/parsing/invoice/calculations";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";
import { withGeneratedAttachment } from "./attachments";

export const invoiceDocumentType: DocumentType<
  typeof sendInvoiceSchema,
  typeof invoiceSchema
> = {
  key: "invoice",
  translatableTitle: getDocumentTypeTitle("invoice"),
  class: "billing",
  sendSchema: sendInvoiceSchema,
  documentSchema: invoiceSchema,

  preprocessFromSendAPI: (data, { company }) => {
    const invoice = sendInvoiceSchema.parse(data.document);
    const issueDate =
      invoice.issueDate ?? formatISO(new Date(), { representation: "date" });
    const preprocessed = {
      ...invoice,
      issueDate,
      dueDate:
        invoice.dueDate ??
        formatISO(addMonths(new Date(issueDate), 1), { representation: "date" }),
      seller: invoice.seller ?? {
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
    return {
      ...preprocessed,
      vat: resolveVatTotals({
        document: preprocessed,
        isDocumentValidationEnforced: true,
      }),
    };
  },

  render: (document, options, context) =>
    renderBillingDocument(document, options, {
      documentId: context.documentId,
      type: "invoice",
      documentTypeTitle: invoiceDocumentType.translatableTitle,
    }),

  generateFilename: (document) => `invoice-${document.invoiceNumber}`,

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
      const { senderName, receiverName } =
        invoiceDocumentType.extractCounterparties(document);
      return {
        documentNumber:
          invoiceDocumentType.extractDocumentNumber(document) ?? undefined,
        amount: document.totals?.payableAmount?.toString(),
        currency: document.totals ? "-" : undefined,
        senderName: senderName ?? undefined,
        receiverName: receiverName ?? undefined,
      };
    },
  },

  extractCounterparties: (document) => ({
    senderName: normalize(document.seller?.name),
    receiverName: normalize(document.buyer?.name),
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } =
      invoiceDocumentType.extractCounterparties(document);
    return [senderName, receiverName, document.invoiceNumber]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.invoiceNumber),
};

export default invoiceDocumentType;
