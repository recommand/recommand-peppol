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
  "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0";

export const ciiD22bFranceCiusFormat: DocumentFormat<
  [typeof invoiceDocumentType, typeof creditNoteDocumentType]
> = {
  key: "cii-d22b-france-cius",
  translatableTitle: "France CII Invoice + Credit Note CIUS",

  docTypeId: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::D22B",
  supportedDocumentTypes: [invoiceDocumentType, creditNoteDocumentType],
  supportedProcessIds: [
    "urn:peppol:france:billing:regulated",
    "urn:peppol:france:billing:non-regulated",
  ],

  encode: (document, _processId, context) =>
    "creditNoteNumber" in document
      ? frenchRegulatedCreditNoteToCII({
          creditNote: document,
          senderAddress: context.senderAddress,
          recipientAddress: context.recipientAddress,
          isDocumentValidationEnforced: context.isDocumentValidationEnforced,
        })
      : frenchRegulatedInvoiceToCII({
          invoice: document,
          senderAddress: context.senderAddress,
          recipientAddress: context.recipientAddress,
          isDocumentValidationEnforced: context.isDocumentValidationEnforced,
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

export default ciiD22bFranceCiusFormat;
