import { invoiceToCII } from "@peppol/utils/parsing/invoice/cii-d22b/to-xml";
import { parseInvoiceFromCII } from "@peppol/utils/parsing/invoice/cii-d22b/from-xml";
import { creditNoteToCII } from "@peppol/utils/parsing/creditnote/cii-d22b/to-xml";
import { parseCreditNoteFromCII } from "@peppol/utils/parsing/creditnote/cii-d22b/from-xml";
import { assertXRechnungRequirements } from "@peppol/utils/parsing/xrechnung/requirements";
import { UserFacingError } from "@peppol/utils/util";
import { invoiceDocumentType } from "../document-types/invoice";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ciiDocumentType } from "./cii-document-type";
import { ciiGuidelineId } from "./xml-detection";
import type { DocumentFormat } from "./types";
import { XRECHNUNG_CUSTOMIZATION_ID, XRECHNUNG_PROCESS_ID } from "./xrechnung";

/**
 * XRechnung in UN/CEFACT CII. Peppol identifies it by the D16B schema version EN 16931
 * binds CII to, which is what XRechnung validates against. The document is written
 * with the D22B writer, which only uses elements D16B has as well.
 */
export const xrechnungCiiFormat: DocumentFormat<
  [typeof invoiceDocumentType, typeof creditNoteDocumentType]
> = {
  key: "xrechnung-cii",
  translatableTitle: "XRechnung 3.0 CII Invoice + Credit Note",

  docTypeId: `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##${XRECHNUNG_CUSTOMIZATION_ID}::D16B`,
  supportedDocumentTypes: [invoiceDocumentType, creditNoteDocumentType],
  supportedProcessIds: [XRECHNUNG_PROCESS_ID],
  smpRegistration: [
    {
      processId: XRECHNUNG_PROCESS_ID,
      translatableTitle: "XRechnung 3.0 CII Invoice + Credit Note",
    },
  ],

  encode: (document, processId, context) => {
    assertXRechnungRequirements(document, context.recipientAddress);
    // A CII credit note carries no due date, so the payment terms are what satisfies
    // BR-CO-25 for the positive amount it states as due.
    if ("creditNoteNumber" in document && !document.paymentTerms?.note?.trim()) {
      throw new UserFacingError(
        "An XRechnung CII credit note requires paymentTerms (BT-20, BR-CO-25), for example { \"note\": \"Amount is credited to your account\" }."
      );
    }
    const options = {
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId: XRECHNUNG_CUSTOMIZATION_ID, processId },
    };
    return "creditNoteNumber" in document
      ? creditNoteToCII({ creditNote: document, ...options })
      : invoiceToCII({ invoice: document, ...options });
  },

  decode: (raw) => {
    const xml = typeof raw === "string" ? raw : raw.toString("utf8");
    return ciiDocumentType(xml) === creditNoteDocumentType
      ? parseCreditNoteFromCII(xml)
      : parseInvoiceFromCII(xml);
  },

  detectDocumentType: (raw) =>
    ciiDocumentType(typeof raw === "string" ? raw : raw.toString("utf8")),

  isFormat: (document) =>
    ciiGuidelineId(document.CrossIndustryInvoice) === XRECHNUNG_CUSTOMIZATION_ID,
};

export default xrechnungCiiFormat;
