import { format } from "date-fns";
import type { z } from "zod";
import { renderFranceCdar } from "@peppol/utils/document-renderer";
import {
  franceCdarSchema,
  getFranceCdarPhaseForStatus,
  sendFranceCdarSchema,
} from "@peppol/utils/parsing/france-cdar/schemas";
import { parsePeppolAddress } from "@peppol/utils/parsing/peppol-address";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";

export const frenchInvoicingCdarDocumentType: DocumentType<
  typeof sendFranceCdarSchema,
  typeof franceCdarSchema
> = {
  key: "frenchInvoicingCdar",
  translatableTitle: getDocumentTypeTitle("frenchInvoicingCdar"),
  class: "transactionMessaging",
  sendSchema: sendFranceCdarSchema,
  documentSchema: franceCdarSchema,

  preprocessFromSendAPI: (data) => {
    const franceCdar = sendFranceCdarSchema.parse(data.document);

    // The endpoint normalises a schemeless recipient to 0208 before anything
    // reads it (api/send-document.ts:205-209).
    let recipientAddress: string | null = data.recipient;
    if (recipientAddress !== null && !recipientAddress.includes(":")) {
      const numberOnlyRecipient = recipientAddress.replace(/[^0-9]/g, "");
      recipientAddress = "0208:" + numberOnlyRecipient;
    }

    // The endpoint fills the defaults on the document object in place; a copy
    // keeps the caller's input untouched.
    const preprocessed: z.output<typeof sendFranceCdarSchema> & {
      recipientElectronicAddress?: string;
      recipientElectronicAddressScheme?: string;
    } = { ...franceCdar };

    if (!preprocessed.id) {
      preprocessed.id = Bun.randomUUIDv7();
    }
    if (!preprocessed.issueDate) {
      preprocessed.issueDate = format(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
    }
    if (!preprocessed.statusDate) {
      preprocessed.statusDate = preprocessed.issueDate;
    }
    if (!preprocessed.phase) {
      preprocessed.phase = getFranceCdarPhaseForStatus(preprocessed.statusCode);
    }
    // BR-FR-CDV-08: only a CDAR addressed to a party other than a platform (WK)
    // or the PPF (DFH) carries the recipient's electronic address, which the
    // endpoint takes from the top-level Peppol recipient rather than the body.
    if (
      preprocessed.recipientRole !== "WK" &&
      preprocessed.recipientRole !== "DFH"
    ) {
      const recipient = parsePeppolAddress(recipientAddress!);
      preprocessed.recipientElectronicAddress = recipient.identifier;
      preprocessed.recipientElectronicAddressScheme = recipient.schemeId;
    }

    return preprocessed;
  },

  render: (document, options, context) =>
    renderFranceCdar(document, options, {
      documentId: context.documentId,
      type: "frenchInvoicingCdar",
      documentTypeTitle: frenchInvoicingCdarDocumentType.translatableTitle,
    }),

  generateFilename: (document) =>
    "invoiceId" in document
      ? `french-invoicing-cdar-${document.invoiceId}`
      : "document",

  pdfGeneration: undefined,

  email: {
    isEmailDeliverySupported: false,
    areEmailNotificationsSupported: true,
    extractDocumentDetails: (document) => {
      const { senderName, receiverName } =
        frenchInvoicingCdarDocumentType.extractCounterparties(document);
      return {
        documentNumber:
          frenchInvoicingCdarDocumentType.extractDocumentNumber(document) ??
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

  extractSearchableText: (document) =>
    frenchInvoicingCdarDocumentType.extractDocumentNumber(document) ?? "",

  extractDocumentNumber: (document) => normalize(document.invoiceId),
};

export default frenchInvoicingCdarDocumentType;
