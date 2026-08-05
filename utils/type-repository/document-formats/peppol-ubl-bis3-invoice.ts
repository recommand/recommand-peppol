import { invoiceToUBL } from "@peppol/utils/parsing/invoice/peppol-ubl-bis3/to-xml";
import { parseInvoiceFromXML } from "@peppol/utils/parsing/invoice/peppol-ubl-bis3/from-xml";
import { invoiceDocumentType } from "../document-types/invoice";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";

export const peppolUblBis3InvoiceFormat: DocumentFormat<
  [typeof invoiceDocumentType]
> = {
  key: "peppol-ubl-bis3-invoice",
  translatableTitle: "Invoice",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  supportedDocumentTypes: [invoiceDocumentType],
  supportedProcessIds: [
    "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
    "urn:peppol:france:billing:regulated",
    "urn:peppol:france:billing:non-regulated",
  ],

  // The process id does not reach the XML: cbc:ProfileID is fixed to the Peppol
  // billing process by invoiceToUBL, so a French BIS 3 invoice carries the Peppol
  // process id today. Honouring the argument here would change what goes on the wire.
  encode: (document, _processId, context) =>
    invoiceToUBL({
      invoice: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
    }),

  decode: (raw) => parseInvoiceFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => invoiceDocumentType,

  // A BIS 3 billing document is the one that may leave the customization id out.
  isFormat: (document) =>
    document.Invoice !== undefined &&
    (ublCustomizationId(document.Invoice) || customizationId) ===
      customizationId,
};

export default peppolUblBis3InvoiceFormat;
