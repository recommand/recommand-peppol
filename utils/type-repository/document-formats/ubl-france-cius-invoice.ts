import { frenchRegulatedInvoiceToUBL } from "@peppol/utils/parsing/invoice/ubl-france-regulated/to-xml";
import { parseFrenchRegulatedInvoiceFromUBL } from "@peppol/utils/parsing/invoice/ubl-france-regulated/from-xml";
import { invoiceDocumentType } from "../document-types/invoice";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0";

export const ublFranceCiusInvoiceFormat: DocumentFormat<
  [typeof invoiceDocumentType]
> = {
  key: "ubl-france-cius-invoice",
  translatableTitle: "France UBL Invoice CIUS",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::2.1",
  supportedDocumentTypes: [invoiceDocumentType],
  supportedProcessIds: [
    "urn:peppol:france:billing:regulated",
    "urn:peppol:france:billing:non-regulated",
  ],

  encode: (document, _processId, context) =>
    frenchRegulatedInvoiceToUBL({
      invoice: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
    }),

  decode: (raw) =>
    parseFrenchRegulatedInvoiceFromUBL(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => invoiceDocumentType,

  isFormat: (document) =>
    ublCustomizationId(document.Invoice) === customizationId,
};

export default ublFranceCiusInvoiceFormat;
