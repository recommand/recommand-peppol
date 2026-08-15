import { invoiceToUBL } from "@peppol/utils/parsing/invoice/peppol-ubl-bis3/to-xml";
import { parseInvoiceFromXML } from "@peppol/utils/parsing/invoice/peppol-ubl-bis3/from-xml";
import { invoiceDocumentType } from "../document-types/invoice";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";
import {
  assertFranceBillingProcessId,
  isFranceBillingProcessId,
} from "./france-process";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const processId = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const regulatedProcessId = "urn:peppol:france:billing:regulated";
const nonRegulatedProcessId = "urn:peppol:france:billing:non-regulated";

export const peppolUblBis3InvoiceFormat: DocumentFormat<
  [typeof invoiceDocumentType]
> = {
  key: "peppol-ubl-bis3-invoice",
  translatableTitle: "Invoice",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  supportedDocumentTypes: [invoiceDocumentType],
  supportedProcessIds: [
    processId,
    regulatedProcessId,
    nonRegulatedProcessId,
  ],
  smpRegistration: [
    { processId, translatableTitle: "Invoice" },
    {
      processId: regulatedProcessId,
      translatableTitle: "France Peppol BIS Billing UBL Invoice",
    },
    {
      processId: nonRegulatedProcessId,
      translatableTitle:
        "France Peppol BIS Billing UBL Invoice (Non-Regulated)",
    },
  ],

  encode: (document, processId, context) => {
    if (isFranceBillingProcessId(processId)) {
      assertFranceBillingProcessId(
        processId,
        document.countrySpecific?.businessProcess,
      );
    }
    return invoiceToUBL({
      invoice: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId },
    });
  },

  decode: (raw) => parseInvoiceFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => invoiceDocumentType,

  // A BIS 3 billing document is the one that may leave the customization id out.
  isFormat: (document) =>
    document.Invoice !== undefined &&
    (ublCustomizationId(document.Invoice) || customizationId) ===
      customizationId,
};

export default peppolUblBis3InvoiceFormat;
