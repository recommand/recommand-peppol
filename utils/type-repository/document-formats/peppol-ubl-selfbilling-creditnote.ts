import { selfBillingCreditNoteToUBL } from "@peppol/utils/parsing/self-billing-creditnote/to-xml";
import { parseSelfBillingCreditNoteFromXML } from "@peppol/utils/parsing/self-billing-creditnote/from-xml";
import { selfBillingCreditNoteDocumentType } from "../document-types/selfBillingCreditNote";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0";
const processId = "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0";

export const peppolUblSelfbillingCreditnoteFormat: DocumentFormat<
  [typeof selfBillingCreditNoteDocumentType]
> = {
  key: "peppol-ubl-selfbilling-creditnote",
  translatableTitle: "Self Billing Credit Note",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1",
  supportedDocumentTypes: [selfBillingCreditNoteDocumentType],
  supportedProcessIds: [processId],
  smpRegistration: [
    { processId, translatableTitle: "Self Billing Credit Note" },
  ],

  encode: (document, processId, context) =>
    selfBillingCreditNoteToUBL({
      selfBillingCreditNote: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId },
    }),

  decode: (raw) =>
    parseSelfBillingCreditNoteFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => selfBillingCreditNoteDocumentType,

  isFormat: (document) =>
    ublCustomizationId(document.CreditNote) === customizationId,
};

export default peppolUblSelfbillingCreditnoteFormat;
