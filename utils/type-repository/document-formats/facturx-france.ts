import type { DocumentTypeInfo } from "@peppol/utils/document-types";
import {
  extractFacturXDocument,
  generateFacturXDocument,
} from "@peppol/data/factur-x/client";
import { findFirstEmbeddedPdfAttachment } from "@peppol/utils/pdf-attachment-helper";
import { UserFacingError } from "@peppol/utils/util";
import { frenchRegulatedInvoiceToCII } from "@peppol/utils/parsing/invoice/cii-d22b-france-regulated/to-xml";
import { parseFrenchRegulatedInvoiceFromCII } from "@peppol/utils/parsing/invoice/cii-d22b-france-regulated/from-xml";
import { frenchRegulatedCreditNoteToCII } from "@peppol/utils/parsing/creditnote/cii-d22b-france-regulated/to-xml";
import { parseFrenchRegulatedCreditNoteFromCII } from "@peppol/utils/parsing/creditnote/cii-d22b-france-regulated/from-xml";
import { invoiceDocumentType } from "../document-types/invoice";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ciiDocumentType } from "./cii-document-type";
import type { DocumentFormat } from "./types";

const docTypeId =
  "urn:peppol:doctype:pdf+xml##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:Factur-X:1.0::D22B";

const regulatedProcessId = "urn:peppol:france:billing:regulated";

// Factur-X puts the CII document inside a PDF/A-3 container, and the container is what
// carries this doc type id. The XML itself declares plain EN 16931 rather than a
// Factur-X guideline, so the identity handed to the serialisers overrides the guideline
// id instead of deriving it from the doc type id above.
function serializerDocumentTypeInfo(
  type: "invoice" | "creditNote"
): DocumentTypeInfo {
  return {
    type,
    title: "France Factur-X Invoice + Credit Note",
    docTypeId,
    processId: regulatedProcessId,
    ciiGuidelineIdOverride: "urn:cen.eu:en16931:2017",
  };
}

export const facturxFranceFormat: DocumentFormat<
  [typeof invoiceDocumentType, typeof creditNoteDocumentType]
> = {
  key: "facturx-france",
  translatableTitle: "France Factur-X Invoice + Credit Note",

  docTypeId,
  supportedDocumentTypes: [invoiceDocumentType, creditNoteDocumentType],
  supportedProcessIds: [regulatedProcessId, "urn:peppol:france:billing:non-regulated"],

  encode: (document, _processId, context) =>
    "creditNoteNumber" in document
      ? frenchRegulatedCreditNoteToCII({
          creditNote: document,
          senderAddress: context.senderAddress,
          recipientAddress: context.recipientAddress,
          isDocumentValidationEnforced: context.isDocumentValidationEnforced,
          documentTypeInfo: serializerDocumentTypeInfo("creditNote"),
        })
      : frenchRegulatedInvoiceToCII({
          invoice: document,
          senderAddress: context.senderAddress,
          recipientAddress: context.recipientAddress,
          isDocumentValidationEnforced: context.isDocumentValidationEnforced,
          documentTypeInfo: serializerDocumentTypeInfo("invoice"),
        }),

  decode: (raw) => {
    const xml = typeof raw === "string" ? raw : raw.toString("utf8");
    return ciiDocumentType(xml) === creditNoteDocumentType
      ? parseFrenchRegulatedCreditNoteFromCII(xml)
      : parseFrenchRegulatedInvoiceFromCII(xml);
  },

  // The container is the PDF, but `decode` and this both read the CII inside it, so a
  // caller unwraps first and asks afterwards.
  detectDocumentType: (raw) =>
    ciiDocumentType(typeof raw === "string" ? raw : raw.toString("utf8")),

  // No `isFormat`: the CII inside the container declares plain EN 16931, which is what
  // `cii-d22b-en16931` recognises. Factur-X is reachable by doc type id only.

  container: {
    contentType: "application/pdf",
    containerFormat: "pdf",
    requiresPdfA: true,

    wrap: async ({ xmlDocument, document }) => {
      const basePdfAttachment = findFirstEmbeddedPdfAttachment(document.attachments);
      if (!basePdfAttachment) {
        const label = "creditNoteNumber" in document ? "credit note" : "invoice";
        throw new UserFacingError(
          `Factur-X ${label} sending requires an embedded PDF attachment or enabled PDF generation.`
        );
      }

      return generateFacturXDocument({
        xmlDocument,
        pdf: {
          filename: basePdfAttachment.filename,
          mimeCode: basePdfAttachment.mimeCode,
          content: Buffer.from(basePdfAttachment.embeddedDocument!, "base64"),
        },
      });
    },

    unwrap: async (payload) => {
      const { xmlDocument } = await extractFacturXDocument({
        pdf: {
          content: payload,
          mimeCode: "application/pdf",
        },
      });
      return xmlDocument;
    },
  },
};

export default facturxFranceFormat;
