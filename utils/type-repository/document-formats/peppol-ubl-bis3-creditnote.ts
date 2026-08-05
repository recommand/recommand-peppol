import { creditNoteToUBL } from "@peppol/utils/parsing/creditnote/peppol-ubl-bis3/to-xml";
import { parseCreditNoteFromXML } from "@peppol/utils/parsing/creditnote/peppol-ubl-bis3/from-xml";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";

export const peppolUblBis3CreditnoteFormat: DocumentFormat<
  [typeof creditNoteDocumentType]
> = {
  key: "peppol-ubl-bis3-creditnote",
  translatableTitle: "Credit Note",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  supportedDocumentTypes: [creditNoteDocumentType],
  supportedProcessIds: [
    "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
    "urn:peppol:france:billing:regulated",
    "urn:peppol:france:billing:non-regulated",
  ],

  // The process id does not reach the XML: cbc:ProfileID is fixed to the Peppol
  // billing process by creditNoteToUBL, so a French BIS 3 credit note carries the Peppol
  // process id today. Honouring the argument here would change what goes on the wire.
  encode: (document, _processId, context) =>
    creditNoteToUBL({
      creditNote: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
    }),

  decode: (raw) => parseCreditNoteFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => creditNoteDocumentType,

  // A BIS 3 billing document is the one that may leave the customization id out.
  isFormat: (document) =>
    document.CreditNote !== undefined &&
    (ublCustomizationId(document.CreditNote) || customizationId) ===
      customizationId,
};

export default peppolUblBis3CreditnoteFormat;
