import { formatISO } from "date-fns";
import { renderBillingDocument } from "@peppol/utils/document-renderer";
import {
  creditNoteSchema,
  sendCreditNoteSchema,
} from "@peppol/utils/parsing/creditnote/schemas";
import { resolveVatTotals } from "@peppol/utils/parsing/invoice/calculations";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import { checkBillingConsistency } from "@peppol/utils/parsing/invoice/consistency";
import type { DocumentType } from "./types";
import { creditNoteAiIntake } from "./billing-intake";
import { normalize } from "./normalize";
import { withGeneratedAttachment } from "./attachments";

export const creditNoteDocumentType: DocumentType<
  typeof sendCreditNoteSchema,
  typeof creditNoteSchema
> = {
  key: "creditNote",
  translatableTitle: getDocumentTypeTitle("creditNote"),
  class: "billing",
  aiIntake: creditNoteAiIntake,
  sendSchema: sendCreditNoteSchema,
  documentSchema: creditNoteSchema,

  preprocessFromSendAPI: (data, { company }) => {
    const creditNote = sendCreditNoteSchema.parse(data.document);
    const preprocessed = {
      ...creditNote,
      issueDate:
        creditNote.issueDate ?? formatISO(new Date(), { representation: "date" }),
      seller: creditNote.seller ?? {
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
      type: "creditNote",
      documentTypeTitle: creditNoteDocumentType.translatableTitle,
    }),

  generateFilename: (document) => `credit-note-${document.creditNoteNumber}`,

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
        creditNoteDocumentType.extractCounterparties(document);
      return {
        documentNumber:
          creditNoteDocumentType.extractDocumentNumber(document) ?? undefined,
        amount: document.totals?.payableAmount?.toString(),
        currency: document.totals ? "-" : undefined,
        senderName: senderName ?? undefined,
        senderEmail: normalize(document.seller?.email) ?? undefined,
        receiverName: receiverName ?? undefined,
        receiverRole: "buyer",
        receiverAddressable: document.buyer,
      };
    },
  },

  extractCounterparties: (document) => ({
    senderName: normalize(document.seller?.name),
    receiverName: normalize(document.buyer?.name),
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } =
      creditNoteDocumentType.extractCounterparties(document);
    return [senderName, receiverName, document.creditNoteNumber]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.creditNoteNumber),

  checkConsistency: checkBillingConsistency,
};

export default creditNoteDocumentType;
