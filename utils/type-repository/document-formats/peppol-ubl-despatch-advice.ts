import { despatchAdviceToUBL } from "@peppol/utils/parsing/despatch-advice/to-xml";
import { parseDespatchAdviceFromXML } from "@peppol/utils/parsing/despatch-advice/from-xml";
import { despatchAdviceDocumentType } from "../document-types/despatchAdvice";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId = "urn:fdc:peppol.eu:poacc:trns:despatch_advice:3";
const processId = "urn:fdc:peppol.eu:poacc:bis:despatch_advice:3";

export const peppolUblDespatchAdviceFormat: DocumentFormat<[typeof despatchAdviceDocumentType]> = {
  key: "peppol-ubl-despatch-advice",
  translatableTitle: "Peppol Despatch Advice transaction 3",

  docTypeId:
    "urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2::DespatchAdvice##urn:fdc:peppol.eu:poacc:trns:despatch_advice:3::2.1",
  supportedDocumentTypes: [despatchAdviceDocumentType],
  supportedProcessIds: [processId],
  smpRegistration: [{ processId, translatableTitle: "Peppol BIS Despatch Advice 3" }],

  encode: (document, processId, context) =>
    despatchAdviceToUBL({
      despatchAdvice: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId },
    }),

  decode: (raw) =>
    parseDespatchAdviceFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => despatchAdviceDocumentType,

  isFormat: (document) => ublCustomizationId(document.DespatchAdvice) === customizationId,
};

export default peppolUblDespatchAdviceFormat;
