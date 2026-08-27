import { invoiceToCII } from "@peppol/utils/parsing/invoice/cii-d22b/to-xml";
import { parseInvoiceFromCII } from "@peppol/utils/parsing/invoice/cii-d22b/from-xml";
import { creditNoteToCII } from "@peppol/utils/parsing/creditnote/cii-d22b/to-xml";
import { parseCreditNoteFromCII } from "@peppol/utils/parsing/creditnote/cii-d22b/from-xml";
import { invoiceDocumentType } from "../document-types/invoice";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ciiDocumentType } from "./cii-document-type";
import { ciiGuidelineId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const guidelineId = "urn:cen.eu:en16931:2017";
const processId = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

export const ciiD22bEn16931Format: DocumentFormat<
  [typeof invoiceDocumentType, typeof creditNoteDocumentType]
> = {
  key: "cii-d22b-en16931",
  translatableTitle: "EN 16931 CII Invoice + Credit Note D22B",

  docTypeId: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##urn:cen.eu:en16931:2017::D22B",
  supportedDocumentTypes: [invoiceDocumentType, creditNoteDocumentType],
  supportedProcessIds: [processId],
  smpRegistration: [
    {
      processId,
      translatableTitle: "EN 16931 CII Invoice + Credit Note D22B",
    },
  ],

  encode: (document, processId, context) =>
    "creditNoteNumber" in document
      ? creditNoteToCII({
          creditNote: document,
          senderAddress: context.senderAddress,
          recipientAddress: context.recipientAddress,
          isDocumentValidationEnforced: context.isDocumentValidationEnforced,
          profile: { customizationId: guidelineId, processId },
        })
      : invoiceToCII({
          invoice: document,
          senderAddress: context.senderAddress,
          recipientAddress: context.recipientAddress,
          isDocumentValidationEnforced: context.isDocumentValidationEnforced,
          profile: { customizationId: guidelineId, processId },
        }),

  decode: (raw) => {
    const xml = typeof raw === "string" ? raw : raw.toString("utf8");
    return ciiDocumentType(xml) === creditNoteDocumentType
      ? parseCreditNoteFromCII(xml)
      : parseInvoiceFromCII(xml);
  },

  detectDocumentType: (raw) =>
    ciiDocumentType(typeof raw === "string" ? raw : raw.toString("utf8")),

  isFormat: (document) =>
    ciiGuidelineId(document.CrossIndustryInvoice) === guidelineId,
};

export default ciiD22bEn16931Format;
