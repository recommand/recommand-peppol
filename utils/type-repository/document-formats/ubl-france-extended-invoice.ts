import { frenchRegulatedInvoiceToUBL } from "@peppol/utils/parsing/invoice/ubl-france-regulated/to-xml";
import { parseFrenchRegulatedInvoiceFromUBL } from "@peppol/utils/parsing/invoice/ubl-france-regulated/from-xml";
import { invoiceDocumentType } from "../document-types/invoice";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";
import { assertFranceBillingProcessId } from "./france-process";

const customizationId =
  "urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0";

const docTypeId =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0::2.1";

const regulatedProcessId = "urn:peppol:france:billing:regulated";
const nonRegulatedProcessId = "urn:peppol:france:billing:non-regulated";

export const ublFranceExtendedInvoiceFormat: DocumentFormat<
  [typeof invoiceDocumentType]
> = {
  key: "ubl-france-extended-invoice",
  translatableTitle: "France UBL Invoice Extended",

  docTypeId,
  supportedDocumentTypes: [invoiceDocumentType],
  supportedProcessIds: [regulatedProcessId, nonRegulatedProcessId],
  smpRegistration: [
    {
      processId: regulatedProcessId,
      translatableTitle: "France UBL Invoice Extended",
    },
    {
      processId: nonRegulatedProcessId,
      translatableTitle: "France UBL Invoice Extended (Non-Regulated)",
    },
  ],

  encode: (document, processId, context) => {
    assertFranceBillingProcessId(
      processId,
      document.countrySpecific?.businessProcess,
    );
    return frenchRegulatedInvoiceToUBL({
      invoice: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId },
    });
  },

  decode: (raw) =>
    parseFrenchRegulatedInvoiceFromUBL(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => invoiceDocumentType,

  isFormat: (document) =>
    ublCustomizationId(document.Invoice) === customizationId,
};

export default ublFranceExtendedInvoiceFormat;
