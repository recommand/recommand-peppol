import { frenchRegulatedInvoiceToUBL } from "@peppol/utils/parsing/invoice/ubl-france-regulated/to-xml";
import { parseFrenchRegulatedInvoiceFromUBL } from "@peppol/utils/parsing/invoice/ubl-france-regulated/from-xml";
import { invoiceDocumentType } from "../document-types/invoice";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";
import {
  assertFranceBillingProcessId,
  FRANCE_CIUS_CUSTOMIZATION_ID,
  isFranceCiusCustomizationId,
} from "./france-process";

const regulatedProcessId = "urn:peppol:france:billing:regulated";
const nonRegulatedProcessId = "urn:peppol:france:billing:non-regulated";

export const ublFranceCiusInvoiceFormat: DocumentFormat<
  [typeof invoiceDocumentType]
> = {
  key: "ubl-france-cius-invoice",
  translatableTitle: "France UBL Invoice CIUS",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::2.1",
  supportedDocumentTypes: [invoiceDocumentType],
  // A French CIUS document may declare plain EN 16931 in BT-24, so only the doc type says the French rules apply.
  validationProfile: "fr-cius",
  supportedProcessIds: [
    regulatedProcessId,
    nonRegulatedProcessId,
  ],
  smpRegistration: [
    {
      processId: regulatedProcessId,
      translatableTitle: "France UBL Invoice CIUS",
    },
    {
      processId: nonRegulatedProcessId,
      translatableTitle: "France UBL Invoice CIUS (Non-Regulated)",
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
      profile: { customizationId: FRANCE_CIUS_CUSTOMIZATION_ID, processId },
    });
  },

  decode: (raw) =>
    parseFrenchRegulatedInvoiceFromUBL(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => invoiceDocumentType,

  isFormat: (document, context) =>
    isFranceCiusCustomizationId(ublCustomizationId(document.Invoice), context),
};

export default ublFranceCiusInvoiceFormat;
