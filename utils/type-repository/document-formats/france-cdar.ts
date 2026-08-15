import { franceCdarToXML } from "@peppol/utils/parsing/france-cdar/to-xml";
import { parseFranceCdarFromXML } from "@peppol/utils/parsing/france-cdar/from-xml";
import { frenchInvoicingCdarDocumentType } from "../document-types/frenchInvoicingCdar";
import { ciiGuidelineId } from "./xml-detection";
import type { DocumentFormat } from "./types";
import {
  assertFranceCdarProcessId,
  getFranceCdarProcessId,
} from "./france-process";

const guidelineId = "urn.cpro.gouv.fr:1p0:CDV:invoice";
const regulatedProcessId = "urn:peppol:france:billing:regulated";
const nonRegulatedProcessId = "urn:peppol:france:billing:non-regulated";

export const franceCdarFormat: DocumentFormat<
  [typeof frenchInvoicingCdarDocumentType]
> = {
  key: "france-cdar",
  translatableTitle: "France Invoicing CDAR",

  docTypeId: "urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100::CrossDomainAcknowledgementAndResponse##urn:peppol:france:billing:cdv:1.0::D22B",
  supportedDocumentTypes: [frenchInvoicingCdarDocumentType],
  supportedProcessIds: [
    regulatedProcessId,
    nonRegulatedProcessId,
  ],
  smpRegistration: [
    {
      processId: regulatedProcessId,
      translatableTitle: "France Invoicing CDAR",
    },
    {
      processId: nonRegulatedProcessId,
      translatableTitle: "France Invoicing CDAR (Non-Regulated)",
    },
  ],
  resolveProcessId: (document) =>
    getFranceCdarProcessId(document.businessProcess),

  encode: (document, processId) => {
    assertFranceCdarProcessId(processId, document.businessProcess);
    return franceCdarToXML({
      franceCdar: document,
    });
  },

  decode: (raw) =>
    parseFranceCdarFromXML(typeof raw === "string" ? raw : raw.toString("utf8")),

  detectDocumentType: () => frenchInvoicingCdarDocumentType,

  // The guideline the document names is not the customization part of its doc type id,
  // and a CDAR may arrive inside a Standard Business Document envelope.
  isFormat: (document) =>
    ciiGuidelineId(
      document.CrossDomainAcknowledgementAndResponse ??
        document.StandardBusinessDocument
          ?.CrossDomainAcknowledgementAndResponse
    ) === guidelineId,
};

export default franceCdarFormat;
