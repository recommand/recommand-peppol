import { formatISO } from "date-fns";
import { renderDespatchAdvice } from "@peppol/utils/operational-document-renderer";
import {
  despatchAdviceSchema,
  sendDespatchAdviceSchema,
} from "@peppol/utils/parsing/despatch-advice/schemas";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";
import { companyIdentifiers, identifiedParty } from "./party-identifiers";
import { withGeneratedAttachment } from "./attachments";

export const despatchAdviceDocumentType: DocumentType<
  typeof sendDespatchAdviceSchema,
  typeof despatchAdviceSchema
> = {
  key: "despatchAdvice",
  translatableTitle: getDocumentTypeTitle("despatchAdvice"),
  class: "operational",
  sendSchema: sendDespatchAdviceSchema,
  documentSchema: despatchAdviceSchema,

  preprocessFromSendAPI: (data, { company }) => {
    const despatchAdvice = sendDespatchAdviceSchema.parse(data.document);
    return {
      ...despatchAdvice,
      issueDate:
        despatchAdvice.issueDate ?? formatISO(new Date(), { representation: "date" }),
      // The despatching party sends the advice, so it is the party defaulted from the company.
      despatchParty: despatchAdvice.despatchParty ?? {
        partyIdentifiers: companyIdentifiers(company),
        name: company.name,
        street: company.address,
        city: company.city,
        postalZone: company.postalCode,
        country: company.country,
        email: company.email || null,
        phone: company.phone || null,
      },
    };
  },

  render: (document, options, context) =>
    renderDespatchAdvice(document, options, {
      documentId: context.documentId,
      type: "despatchAdvice",
      documentTypeTitle: despatchAdviceDocumentType.translatableTitle,
    }),

  generateFilename: (document) => `despatch-advice-${document.despatchAdviceNumber}`,

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
        despatchAdviceDocumentType.extractCounterparties(document);
      return {
        documentNumber: despatchAdviceDocumentType.extractDocumentNumber(document) ?? undefined,
        amount: undefined,
        currency: undefined,
        senderName: senderName ?? undefined,
        senderEmail: normalize(document.despatchParty?.email) ?? undefined,
        receiverName: receiverName ?? undefined,
        receiverRole: "consignee",
        receiverAddressable: identifiedParty(document.consignee.partyIdentifiers),
      };
    },
  },

  extractCounterparties: (document) => ({
    senderName: normalize(document.despatchParty?.name),
    receiverName: normalize(document.consignee?.name),
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } =
      despatchAdviceDocumentType.extractCounterparties(document);
    return [senderName, receiverName, document.despatchAdviceNumber, document.orderReference]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.despatchAdviceNumber),
};

export default despatchAdviceDocumentType;
