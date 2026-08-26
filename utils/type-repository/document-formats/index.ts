import {
  isCountrySpecificProcessIdAllowed,
  resolveCountrySpecificProcessId,
} from "@peppol/utils/parsing/country-specific/process";
import { parseXmlForDetection } from "./xml-detection";
import type { AnyDocumentFormat } from "./types";
import { peppolUblBis3InvoiceFormat } from "./peppol-ubl-bis3-invoice";
import { peppolUblBis3CreditnoteFormat } from "./peppol-ubl-bis3-creditnote";
import { peppolUblSelfbillingInvoiceFormat } from "./peppol-ubl-selfbilling-invoice";
import { peppolUblSelfbillingCreditnoteFormat } from "./peppol-ubl-selfbilling-creditnote";
import { peppolUblMlrFormat } from "./peppol-ubl-mlr";
import { siUblInvoiceFormat } from "./si-ubl-invoice";
import { siUblCreditnoteFormat } from "./si-ubl-creditnote";
import { ciiD22bEn16931Format } from "./cii-d22b-en16931";
import { ciiD22bFranceCiusFormat } from "./cii-d22b-france-cius";
import { ciiD22bFranceExtendedFormat } from "./cii-d22b-france-extended";
import { ublFranceCiusInvoiceFormat } from "./ubl-france-cius-invoice";
import { ublFranceCiusCreditnoteFormat } from "./ubl-france-cius-creditnote";
import { ublFranceExtendedInvoiceFormat } from "./ubl-france-extended-invoice";
import { ublFranceExtendedCreditnoteFormat } from "./ubl-france-extended-creditnote";
import { facturxFranceFormat } from "./facturx-france";
import { franceCdarFormat } from "./france-cdar";

/** Every document format the platform can write and read, ordered by preference. */
export const documentFormats: readonly AnyDocumentFormat[] = [
  peppolUblBis3InvoiceFormat,
  peppolUblBis3CreditnoteFormat,
  peppolUblSelfbillingInvoiceFormat,
  peppolUblSelfbillingCreditnoteFormat,
  peppolUblMlrFormat,
  siUblInvoiceFormat,
  siUblCreditnoteFormat,
  ublFranceCiusInvoiceFormat,
  ublFranceCiusCreditnoteFormat,
  ublFranceExtendedInvoiceFormat,
  ublFranceExtendedCreditnoteFormat,
  ciiD22bEn16931Format,
  ciiD22bFranceCiusFormat,
  ciiD22bFranceExtendedFormat,
  facturxFranceFormat,
  franceCdarFormat,
];

export function getDocumentFormat(key: string): AnyDocumentFormat | undefined {
  return documentFormats.find((format) => format.key === key);
}

/** The doc type id is what an incoming transmission names, so reception looks up by it. */
export function getDocumentFormatByDocTypeId(
  docTypeId: string
): AnyDocumentFormat | undefined {
  return documentFormats.find((format) => format.docTypeId === docTypeId);
}

/** The document type key is what an outgoing transmission names, so sending looks up by it. */
export function getDocumentFormatsByDocumentTypeKey(documentTypeKey: string): AnyDocumentFormat[] {
  return documentFormats.filter((format) => format.supportedDocumentTypes.some((type) => type.key === documentTypeKey));
}

export function resolveFormatProcessId(
  format: AnyDocumentFormat,
  document: unknown
): string {
  return (
    format.resolveProcessId?.(document) ??
    resolveCountrySpecificProcessId(format.supportedProcessIds[0], document)
  );
}

/**
 * Every process id the format may send this document over, most preferred first: the one
 * the document itself selects, then the remaining declared ones in the order the format
 * states them, which is the order they are to be preferred in. A format that resolves the
 * process from the document offers no alternatives — the resolved one is the only process
 * that matches what the document says it is.
 */
export function resolveFormatProcessIdCandidates(
  format: AnyDocumentFormat,
  document: unknown
): string[] {
  const resolved = format.resolveProcessId?.(document as any);
  if (resolved) return [resolved];

  const preferred = resolveCountrySpecificProcessId(
    format.supportedProcessIds[0],
    document
  );
  return [
    preferred,
    ...format.supportedProcessIds.filter(
      (processId) =>
        processId !== preferred &&
        isCountrySpecificProcessIdAllowed(processId, document)
    ),
  ];
}

export function detectDocumentFormat(
  xml: string
): AnyDocumentFormat | undefined {
  const parsed = parseXmlForDetection(xml);
  if (!parsed) return undefined;
  return documentFormats.find((format) => format.isFormat?.(parsed));
}
