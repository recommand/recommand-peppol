import { creditNoteToUBL } from "@peppol/utils/parsing/creditnote/peppol-ubl-bis3/to-xml";
import { parseCreditNoteFromXML } from "@peppol/utils/parsing/creditnote/peppol-ubl-bis3/from-xml";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0";
const processId = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

export const siUblCreditnoteFormat: DocumentFormat<
  [typeof creditNoteDocumentType]
> = {
  key: "si-ubl-creditnote",
  translatableTitle: "SI-UBL 2.0 Credit Note",
  docTypeId: `urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##${customizationId}::2.1`,
  supportedDocumentTypes: [creditNoteDocumentType],
  supportedProcessIds: [processId],
  smpRegistration: [
    { processId, translatableTitle: "SI-UBL 2.0 Credit Note" },
  ],
  encode: (document, processId, context) =>
    creditNoteToUBL({
      creditNote: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId },
    }),
  decode: (raw) =>
    parseCreditNoteFromXML(
      typeof raw === "string" ? raw : raw.toString("utf8"),
    ),
  detectDocumentType: () => creditNoteDocumentType,
  isFormat: (document) =>
    ublCustomizationId(document.CreditNote) === customizationId,
};
