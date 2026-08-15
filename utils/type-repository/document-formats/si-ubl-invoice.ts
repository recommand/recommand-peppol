import { invoiceToUBL } from "@peppol/utils/parsing/invoice/peppol-ubl-bis3/to-xml";
import { parseInvoiceFromXML } from "@peppol/utils/parsing/invoice/peppol-ubl-bis3/from-xml";
import { invoiceDocumentType } from "../document-types/invoice";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0";
const processId = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

export const siUblInvoiceFormat: DocumentFormat<
  [typeof invoiceDocumentType]
> = {
  key: "si-ubl-invoice",
  translatableTitle: "SI-UBL 2.0 Invoice",
  docTypeId: `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${customizationId}::2.1`,
  supportedDocumentTypes: [invoiceDocumentType],
  supportedProcessIds: [processId],
  smpRegistration: [
    { processId, translatableTitle: "SI-UBL 2.0 Invoice" },
  ],
  encode: (document, processId, context) =>
    invoiceToUBL({
      invoice: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId },
    }),
  decode: (raw) =>
    parseInvoiceFromXML(
      typeof raw === "string" ? raw : raw.toString("utf8"),
    ),
  detectDocumentType: () => invoiceDocumentType,
  isFormat: (document) =>
    ublCustomizationId(document.Invoice) === customizationId,
};
