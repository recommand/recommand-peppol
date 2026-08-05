import { franceCdarToXML } from "@peppol/utils/parsing/france-cdar/to-xml";
import { parseFranceCdarFromXML } from "@peppol/utils/parsing/france-cdar/from-xml";
import { frenchInvoicingCdarDocumentType } from "../document-types/frenchInvoicingCdar";
import { ciiGuidelineId } from "./xml-detection";
import type { DocumentFormat } from "./types";

const guidelineId = "urn.cpro.gouv.fr:1p0:CDV:invoice";

export const franceCdarFormat: DocumentFormat<
  [typeof frenchInvoicingCdarDocumentType]
> = {
  key: "france-cdar",
  translatableTitle: "France Invoicing CDAR",

  docTypeId: "urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100::CrossDomainAcknowledgementAndResponse##urn:peppol:france:billing:cdv:1.0::D22B",
  supportedDocumentTypes: [frenchInvoicingCdarDocumentType],
  supportedProcessIds: [
    "urn:peppol:france:billing:regulated",
    "urn:peppol:france:billing:non-regulated",
  ],

  encode: (document) =>
    franceCdarToXML({
      franceCdar: document,
    }),

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
