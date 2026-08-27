import { creditNoteToUBL } from "@peppol/utils/parsing/creditnote/peppol-ubl-bis3/to-xml";
import { parseCreditNoteFromXML } from "@peppol/utils/parsing/creditnote/peppol-ubl-bis3/from-xml";
import { creditNoteDocumentType } from "../document-types/creditNote";
import { ublCustomizationId } from "./xml-detection";
import type { DocumentFormat } from "./types";
import {
  assertFranceBillingProcessId,
  isFranceBillingProcessId,
} from "./france-process";

const customizationId =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const billingProcessId = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const regulatedProcessId = "urn:peppol:france:billing:regulated";
const nonRegulatedProcessId = "urn:peppol:france:billing:non-regulated";

export const peppolUblBis3CreditnoteFormat: DocumentFormat<
  [typeof creditNoteDocumentType]
> = {
  key: "peppol-ubl-bis3-creditnote",
  translatableTitle: "Credit Note",

  docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  supportedDocumentTypes: [creditNoteDocumentType],
  supportedProcessIds: [
    billingProcessId,
    regulatedProcessId,
    nonRegulatedProcessId,
  ],
  smpRegistration: [
    { processId: billingProcessId, translatableTitle: "Credit Note" },
    {
      processId: regulatedProcessId,
      translatableTitle: "France Peppol BIS Billing UBL Credit Note",
    },
    {
      processId: nonRegulatedProcessId,
      translatableTitle:
        "France Peppol BIS Billing UBL Credit Note (Non-Regulated)",
    },
  ],

  encode: (document, processId, context) => {
    if (isFranceBillingProcessId(processId)) {
      assertFranceBillingProcessId(
        processId,
        document.countrySpecific?.businessProcess,
      );
    }
    // The process the document travels over is not the one it declares: a Peppol BIS
    // Billing 3.0 payload always names the BIS process in BT-23, whichever process
    // carries it. A French process id there leaves the receiver without a ruleset to
    // resolve the document against.
    return creditNoteToUBL({
      creditNote: document,
      senderAddress: context.senderAddress,
      recipientAddress: context.recipientAddress,
      isDocumentValidationEnforced: context.isDocumentValidationEnforced,
      profile: { customizationId, processId: billingProcessId },
    });
  },

  decode: (raw) => parseCreditNoteFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => creditNoteDocumentType,

  // A BIS 3 billing document is the one that may leave the customization id out.
  isFormat: (document) =>
    document.CreditNote !== undefined &&
    (ublCustomizationId(document.CreditNote) || customizationId) ===
      customizationId,
};

export default peppolUblBis3CreditnoteFormat;
