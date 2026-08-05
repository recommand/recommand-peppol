import type { DocumentTypeInfo } from "@peppol/utils/document-types";
import { frenchRegulatedCreditNoteToUBL } from "@peppol/utils/parsing/creditnote/ubl-france-regulated/to-xml";
import { parseFrenchRegulatedCreditNoteFromUBL } from "@peppol/utils/parsing/creditnote/ubl-france-regulated/from-xml";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId =
  "urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0";

const docTypeId =
  "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0::2.1";

const regulatedProcessId = "urn:peppol:france:billing:regulated";

const serializerDocumentTypeInfo: DocumentTypeInfo = {
  type: "creditNote",
  title: "France UBL Credit Note Extended",
  docTypeId,
  processId: regulatedProcessId,
};

export const ublFranceExtendedCreditnoteFormat: DocumentFormat<
  [typeof creditNoteDocumentType]
> = {
  key: "ubl-france-extended-creditnote",
  translatableTitle: "France UBL Credit Note Extended",

  docTypeId,
  supportedDocumentTypes: [creditNoteDocumentType],
  supportedProcessIds: [regulatedProcessId, "urn:peppol:france:billing:non-regulated"],

  encode: (document, _processId, context) =>
    frenchRegulatedCreditNoteToUBL({
      creditNote: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      documentTypeInfo: serializerDocumentTypeInfo,
    }),

  decode: (raw) =>
    parseFrenchRegulatedCreditNoteFromUBL(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => creditNoteDocumentType,

  isFormat: (document) =>
    ublCustomizationId(document.CreditNote) === customizationId,
};

export default ublFranceExtendedCreditnoteFormat;
