import { formatISO } from "date-fns";
import { renderBillingDocument } from "@peppol/utils/document-renderer";
import {
  selfBillingCreditNoteSchema,
  sendSelfBillingCreditNoteSchema,
} from "@peppol/utils/parsing/self-billing-creditnote/schemas";
import { resolveVatTotals } from "@peppol/utils/parsing/invoice/calculations";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";
import { withGeneratedAttachment } from "./attachments";

export const selfBillingCreditNoteDocumentType: DocumentType<
  typeof sendSelfBillingCreditNoteSchema,
  typeof selfBillingCreditNoteSchema
> = {
  key: "selfBillingCreditNote",
  translatableTitle: "Self Billing Credit Note",
  class: "billing",
  sendSchema: sendSelfBillingCreditNoteSchema,
  documentSchema: selfBillingCreditNoteSchema,

  preprocessFromSendAPI: (data, { company }) => {
    const selfBillingCreditNote = sendSelfBillingCreditNoteSchema.parse(
      data.document
    );
    const preprocessed = {
      ...selfBillingCreditNote,
      issueDate:
        selfBillingCreditNote.issueDate ??
        formatISO(new Date(), { representation: "date" }),
      // Self-billing reverses the roles: the buyer issues the document, so the
      // company sending it fills the buyer, not the seller.
      buyer: selfBillingCreditNote.buyer ?? {
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
      type: "selfBillingCreditNote",
      documentTypeTitle: selfBillingCreditNoteDocumentType.translatableTitle,
    }),

  generateFilename: (document) =>
    `self-billing-credit-note-${document.creditNoteNumber}`,

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
        selfBillingCreditNoteDocumentType.extractCounterparties(document);
      return {
        documentNumber:
          selfBillingCreditNoteDocumentType.extractDocumentNumber(document) ??
          undefined,
        amount: document.totals?.payableAmount?.toString(),
        currency: document.totals ? "-" : undefined,
        senderName: senderName ?? undefined,
        receiverName: receiverName ?? undefined,
      };
    },
  },

  extractCounterparties: (document) => ({
    senderName: normalize(document.buyer?.name),
    receiverName: normalize(document.seller?.name),
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } =
      selfBillingCreditNoteDocumentType.extractCounterparties(document);
    return [senderName, receiverName, document.creditNoteNumber]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.creditNoteNumber),
};

export default selfBillingCreditNoteDocumentType;
