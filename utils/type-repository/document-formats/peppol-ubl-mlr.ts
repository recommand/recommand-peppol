import { messageLevelResponseToXML } from "@peppol/utils/parsing/message-level-response/to-xml";
import { parseMessageLevelResponseFromXML } from "@peppol/utils/parsing/message-level-response/from-xml";
import { messageLevelResponseDocumentType } from "../document-types/messageLevelResponse";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId = "urn:fdc:peppol.eu:poacc:trns:mlr:3";

export const peppolUblMlrFormat: DocumentFormat<
  [typeof messageLevelResponseDocumentType]
> = {
  key: "peppol-ubl-mlr",
  translatableTitle: "Message Level Response",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2::ApplicationResponse##urn:fdc:peppol.eu:poacc:trns:mlr:3::2.1",
  supportedDocumentTypes: [messageLevelResponseDocumentType],
  supportedProcessIds: ["urn:fdc:peppol.eu:poacc:bis:mlr:3"],

  encode: (document, _processId, context) =>
    messageLevelResponseToXML({
      messageLevelResponse: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
    }),

  decode: (raw) =>
    parseMessageLevelResponseFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => messageLevelResponseDocumentType,

  isFormat: (document) =>
    ublCustomizationId(document.ApplicationResponse) === customizationId,
};

export default peppolUblMlrFormat;
