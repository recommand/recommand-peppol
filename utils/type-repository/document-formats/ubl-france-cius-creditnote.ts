import { frenchRegulatedCreditNoteToUBL } from "@peppol/utils/parsing/creditnote/ubl-france-regulated/to-xml";
import { parseFrenchRegulatedCreditNoteFromUBL } from "@peppol/utils/parsing/creditnote/ubl-france-regulated/from-xml";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0";

export const ublFranceCiusCreditnoteFormat: DocumentFormat<
  [typeof creditNoteDocumentType]
> = {
  key: "ubl-france-cius-creditnote",
  translatableTitle: "France UBL Credit Note CIUS",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::2.1",
  supportedDocumentTypes: [creditNoteDocumentType],
  supportedProcessIds: [
    "urn:peppol:france:billing:regulated",
    "urn:peppol:france:billing:non-regulated",
  ],

  encode: (document, _processId, context) =>
    frenchRegulatedCreditNoteToUBL({
      creditNote: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
    }),

  decode: (raw) =>
    parseFrenchRegulatedCreditNoteFromUBL(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => creditNoteDocumentType,

  isFormat: (document) =>
    ublCustomizationId(document.CreditNote) === customizationId,
};

export default ublFranceCiusCreditnoteFormat;
