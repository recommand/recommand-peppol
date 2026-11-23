import { orderToUBL } from "@peppol/utils/parsing/order/to-xml";
import { parseOrderFromXML } from "@peppol/utils/parsing/order/from-xml";
import { orderDocumentType } from "../document-types/order";
import { ublCustomizationId } from "./xml-detection";
import { getTextContent } from "@peppol/utils/parsing/xml-helpers";
import type { DocumentFormat } from "./types";

const customizationId = "urn:fdc:peppol.eu:poacc:trns:order:3";
// Ordering expects the seller to answer with an order response; order only does not.
// Advanced ordering adds order changes and cancellations, which are not supported, so
// it is only sent over, never registered for.
const orderingProcessId = "urn:fdc:peppol.eu:poacc:bis:ordering:3";
const orderOnlyProcessId = "urn:fdc:peppol.eu:poacc:bis:order_only:3";
const advancedOrderingProcessId = "urn:fdc:peppol.eu:poacc:bis:advanced_ordering:3";

export const peppolUblOrderFormat: DocumentFormat<[typeof orderDocumentType]> = {
  key: "peppol-ubl-order",
  translatableTitle: "Peppol Order transaction 3",

  docTypeId:
    "urn:oasis:names:specification:ubl:schema:xsd:Order-2::Order##urn:fdc:peppol.eu:poacc:trns:order:3::2.1",
  supportedDocumentTypes: [orderDocumentType],
  supportedProcessIds: [orderingProcessId, orderOnlyProcessId, advancedOrderingProcessId],
  smpRegistration: [
    { processId: orderingProcessId, translatableTitle: "Peppol BIS Ordering 3 Order" },
    { processId: orderOnlyProcessId, translatableTitle: "Peppol BIS Order Only 3 Order" },
  ],

  // An order names the process it travels over (PEPPOL-T01-R031).
  encode: (document, processId, context) =>
    orderToUBL({
      order: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId },
    }),

  decode: (raw) => parseOrderFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => orderDocumentType,

  isFormat: (document) => ublCustomizationId(document.Order) === customizationId,

  declaredProcessId: (document) => getTextContent(document.Order?.ProfileID).trim() || undefined,
};

export default peppolUblOrderFormat;
