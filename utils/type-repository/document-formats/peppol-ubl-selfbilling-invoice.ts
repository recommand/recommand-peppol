import { selfBillingInvoiceToUBL } from "@peppol/utils/parsing/self-billing-invoice/to-xml";
import { parseSelfBillingInvoiceFromXML } from "@peppol/utils/parsing/self-billing-invoice/from-xml";
import { selfBillingInvoiceDocumentType } from "../document-types/selfBillingInvoice";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0";

export const peppolUblSelfbillingInvoiceFormat: DocumentFormat<
  [typeof selfBillingInvoiceDocumentType]
> = {
  key: "peppol-ubl-selfbilling-invoice",
  translatableTitle: "Self Billing Invoice",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1",
  supportedDocumentTypes: [selfBillingInvoiceDocumentType],
  supportedProcessIds: ["urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0"],

  encode: (document, _processId, context) =>
    selfBillingInvoiceToUBL({
      selfBillingInvoice: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
    }),

  decode: (raw) =>
    parseSelfBillingInvoiceFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => selfBillingInvoiceDocumentType,

  isFormat: (document) =>
    ublCustomizationId(document.Invoice) === customizationId,
};

export default peppolUblSelfbillingInvoiceFormat;
