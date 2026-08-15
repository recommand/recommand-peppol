import { frenchRegulatedCreditNoteToUBL } from "@peppol/utils/parsing/creditnote/ubl-france-regulated/to-xml";
import { parseFrenchRegulatedCreditNoteFromUBL } from "@peppol/utils/parsing/creditnote/ubl-france-regulated/from-xml";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";
import { assertFranceBillingProcessId } from "./france-process";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0";
const regulatedProcessId = "urn:peppol:france:billing:regulated";
const nonRegulatedProcessId = "urn:peppol:france:billing:non-regulated";

export const ublFranceCiusCreditnoteFormat: DocumentFormat<
  [typeof creditNoteDocumentType]
> = {
  key: "ubl-france-cius-creditnote",
  translatableTitle: "France UBL Credit Note CIUS",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::2.1",
  supportedDocumentTypes: [creditNoteDocumentType],
  supportedProcessIds: [
    regulatedProcessId,
    nonRegulatedProcessId,
  ],
  smpRegistration: [
    {
      processId: regulatedProcessId,
      translatableTitle: "France UBL Credit Note CIUS",
    },
    {
      processId: nonRegulatedProcessId,
      translatableTitle: "France UBL Credit Note CIUS (Non-Regulated)",
    },
  ],

  encode: (document, processId, context) => {
    assertFranceBillingProcessId(
      processId,
      document.countrySpecific?.businessProcess,
    );
    return frenchRegulatedCreditNoteToUBL({
      creditNote: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId },
    });
  },

  decode: (raw) =>
    parseFrenchRegulatedCreditNoteFromUBL(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => creditNoteDocumentType,

  isFormat: (document) =>
    ublCustomizationId(document.CreditNote) === customizationId,
};

export default ublFranceCiusCreditnoteFormat;
