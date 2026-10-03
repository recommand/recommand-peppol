import { invoiceToUBL } from "@peppol/utils/parsing/invoice/peppol-ubl-bis3/to-xml";
import { parseInvoiceFromXML } from "@peppol/utils/parsing/invoice/peppol-ubl-bis3/from-xml";
import { assertXRechnungRequirements } from "@peppol/utils/parsing/xrechnung/requirements";
import { invoiceDocumentType } from "../document-types/invoice";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";
import { XRECHNUNG_CUSTOMIZATION_ID, XRECHNUNG_PROCESS_ID } from "./xrechnung";

export const xrechnungUblInvoiceFormat: DocumentFormat<
  [typeof invoiceDocumentType]
> = {
  key: "xrechnung-ubl-invoice",
  translatableTitle: "XRechnung 3.0 UBL Invoice",
  docTypeId: `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${XRECHNUNG_CUSTOMIZATION_ID}::2.1`,
  supportedDocumentTypes: [invoiceDocumentType],
  supportedProcessIds: [XRECHNUNG_PROCESS_ID],
  smpRegistration: [
    { processId: XRECHNUNG_PROCESS_ID, translatableTitle: "XRechnung 3.0 UBL Invoice" },
  ],
  encode: (document, processId, context) => {
    assertXRechnungRequirements(document, context.recipientAddress);
    return invoiceToUBL({
      invoice: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId: XRECHNUNG_CUSTOMIZATION_ID, processId },
    });
  },
  decode: (raw) =>
    parseInvoiceFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),
  detectDocumentType: () => invoiceDocumentType,
  isFormat: (document) =>
    ublCustomizationId(document.Invoice) === XRECHNUNG_CUSTOMIZATION_ID,
};
