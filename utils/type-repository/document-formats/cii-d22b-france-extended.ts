import type { DocumentTypeInfo } from "@peppol/utils/document-types";
import { frenchRegulatedInvoiceToCII } from "@peppol/utils/parsing/invoice/cii-d22b-france-regulated/to-xml";
import { parseFrenchRegulatedInvoiceFromCII } from "@peppol/utils/parsing/invoice/cii-d22b-france-regulated/from-xml";
import { frenchRegulatedCreditNoteToCII } from "@peppol/utils/parsing/creditnote/cii-d22b-france-regulated/to-xml";
import { parseFrenchRegulatedCreditNoteFromCII } from "@peppol/utils/parsing/creditnote/cii-d22b-france-regulated/from-xml";
import { invoiceDocumentType } from "../document-types/invoice";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ciiDocumentType } from "./cii-document-type";
import { ciiGuidelineId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const guidelineId =
  "urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0";

const docTypeId =
  "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0::D22B";

const regulatedProcessId = "urn:peppol:france:billing:regulated";

function serializerDocumentTypeInfo(
  type: "invoice" | "creditNote"
): DocumentTypeInfo {
  return {
    type,
    title: "France CII Invoice + Credit Note Extended",
    docTypeId,
    processId: regulatedProcessId,
  };
}

export const ciiD22bFranceExtendedFormat: DocumentFormat<
  [typeof invoiceDocumentType, typeof creditNoteDocumentType]
> = {
  key: "cii-d22b-france-extended",
  translatableTitle: "France CII Invoice + Credit Note Extended",

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

  detectDocumentType: (raw) =>
    ciiDocumentType(typeof raw === "string" ? raw : raw.toString("utf8")),

  isFormat: (document) =>
    ciiGuidelineId(document.CrossIndustryInvoice) === guidelineId,
};

export default ciiD22bFranceExtendedFormat;
