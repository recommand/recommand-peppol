import { orderResponseToUBL } from "@peppol/utils/parsing/order-response/to-xml";
import { parseOrderResponseFromXML } from "@peppol/utils/parsing/order-response/from-xml";
import { orderResponseDocumentType } from "../document-types/orderResponse";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId = "urn:fdc:peppol.eu:poacc:trns:order_response:3";
// An order response belongs to the ordering process alone.
const processId = "urn:fdc:peppol.eu:poacc:bis:ordering:3";

export const peppolUblOrderResponseFormat: DocumentFormat<[typeof orderResponseDocumentType]> = {
  key: "peppol-ubl-order-response",
  translatableTitle: "Peppol Order Response transaction 3",

  docTypeId:
    "urn:oasis:names:specification:ubl:schema:xsd:OrderResponse-2::OrderResponse##urn:fdc:peppol.eu:poacc:trns:order_response:3::2.1",
  supportedDocumentTypes: [orderResponseDocumentType],
  supportedProcessIds: [processId],
  smpRegistration: [{ processId, translatableTitle: "Peppol BIS Ordering 3 Order Response" }],

  encode: (document, processId, context) =>
    orderResponseToUBL({
      orderResponse: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId },
    }),

  decode: (raw) =>
    parseOrderResponseFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => orderResponseDocumentType,

  isFormat: (document) => ublCustomizationId(document.OrderResponse) === customizationId,
};

export default peppolUblOrderResponseFormat;
