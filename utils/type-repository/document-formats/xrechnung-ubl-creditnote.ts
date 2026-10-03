import { creditNoteToUBL } from "@peppol/utils/parsing/creditnote/peppol-ubl-bis3/to-xml";
import { parseCreditNoteFromXML } from "@peppol/utils/parsing/creditnote/peppol-ubl-bis3/from-xml";
import { assertXRechnungRequirements } from "@peppol/utils/parsing/xrechnung/requirements";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";
import { XRECHNUNG_CUSTOMIZATION_ID, XRECHNUNG_PROCESS_ID } from "./xrechnung";

export const xrechnungUblCreditnoteFormat: DocumentFormat<
  [typeof creditNoteDocumentType]
> = {
  key: "xrechnung-ubl-creditnote",
  translatableTitle: "XRechnung 3.0 UBL Credit Note",
  docTypeId: `urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##${XRECHNUNG_CUSTOMIZATION_ID}::2.1`,
  supportedDocumentTypes: [creditNoteDocumentType],
  supportedProcessIds: [XRECHNUNG_PROCESS_ID],
  smpRegistration: [
    { processId: XRECHNUNG_PROCESS_ID, translatableTitle: "XRechnung 3.0 UBL Credit Note" },
  ],
  encode: (document, processId, context) => {
    assertXRechnungRequirements(document, context.recipientAddress);
    return creditNoteToUBL({
      creditNote: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId: XRECHNUNG_CUSTOMIZATION_ID, processId },
    });
  },
  decode: (raw) =>
    parseCreditNoteFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),
  detectDocumentType: () => creditNoteDocumentType,
  isFormat: (document) =>
    ublCustomizationId(document.CreditNote) === XRECHNUNG_CUSTOMIZATION_ID,
};
