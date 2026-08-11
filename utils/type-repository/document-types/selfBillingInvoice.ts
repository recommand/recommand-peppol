import { addMonths, formatISO } from "date-fns";
import { renderBillingDocument } from "@peppol/utils/document-renderer";
import {
  selfBillingInvoiceSchema,
  sendSelfBillingInvoiceSchema,
} from "@peppol/utils/parsing/self-billing-invoice/schemas";
import { resolveVatTotals } from "@peppol/utils/parsing/invoice/calculations";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";
import { withGeneratedAttachment } from "./attachments";

export const selfBillingInvoiceDocumentType: DocumentType<
  typeof sendSelfBillingInvoiceSchema,
  typeof selfBillingInvoiceSchema
> = {
  key: "selfBillingInvoice",
  translatableTitle: "Self Billing Invoice",
  class: "billing",
  sendSchema: sendSelfBillingInvoiceSchema,
  documentSchema: selfBillingInvoiceSchema,

  preprocessFromSendAPI: (data, { company }) => {
    const invoice = sendSelfBillingInvoiceSchema.parse(data.document);
    const issueDate =
      invoice.issueDate ?? formatISO(new Date(), { representation: "date" });
    const preprocessed = {
      ...invoice,
      issueDate,
      dueDate:
        invoice.dueDate ??
        formatISO(addMonths(new Date(issueDate), 1), { representation: "date" }),
      // Self-billing reverses the roles: the company sending the document is the
      // buyer, so that is the party defaulted from the company.
      buyer: invoice.buyer ?? {
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
      type: "selfBillingInvoice",
    }),

  generateFilename: (document) =>
    `self-billing-invoice-${document.invoiceNumber}`,

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
        selfBillingInvoiceDocumentType.extractCounterparties(document);
      return {
        documentNumber:
          selfBillingInvoiceDocumentType.extractDocumentNumber(document) ??
          undefined,
        amount: document.totals?.payableAmount?.toString(),
        currency: document.totals ? "-" : undefined,
        senderName: senderName ?? undefined,
        receiverName: receiverName ?? undefined,
      };
    },
  },

  // Self-billing reverses the roles: the buyer issues and sends the document.
  extractCounterparties: (document) => ({
    senderName: normalize(document.buyer?.name),
    receiverName: normalize(document.seller?.name),
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } =
      selfBillingInvoiceDocumentType.extractCounterparties(document);
    return [senderName, receiverName, document.invoiceNumber]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.invoiceNumber),
};

export default selfBillingInvoiceDocumentType;
