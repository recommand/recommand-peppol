import {
  documentFormats,
  getDocumentFormatsByDocumentTypeKey,
} from "../document-formats";
import type { ReceivingCapability } from "./types";

const invoiceResponseCapability: ReceivingCapability = {
  formatKey: "peppol-ubl-invoice-response",
  translatableTitle: "Invoice Response",
  docTypeId:
    "urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2::ApplicationResponse##urn:fdc:peppol.eu:poacc:trns:invoice_response:3::2.1",
  processId: "urn:fdc:peppol.eu:poacc:bis:invoice_response:3",
};

export const receivingCapabilities: readonly ReceivingCapability[] = [
  ...documentFormats.flatMap((format) =>
    (format.smpRegistration ?? []).map((registration) => ({
      formatKey: format.key,
      docTypeId: format.docTypeId,
      ...registration,
    })),
  ),
  invoiceResponseCapability,
];

const receivingCapabilityAliases: Readonly<Record<string, ReceivingCapability>> = {
  invoiceResponse: invoiceResponseCapability,
};

export function getReceivingCapability(
  formatKey: string,
  processId: string,
): ReceivingCapability {
  const capability = receivingCapabilities.find(
    (candidate) =>
      candidate.formatKey === formatKey && candidate.processId === processId,
  );
  if (!capability) {
    throw new Error(
      `Receiving capability '${formatKey}' with process '${processId}' not found.`,
    );
  }
  return capability;
}

export function resolveDocTypeId(value: string): string {
  return (
    getDocumentFormatsByDocumentTypeKey(value)[0]?.docTypeId ??
    receivingCapabilityAliases[value]?.docTypeId ??
    value
  );
}

export type { ReceivingCapability } from "./types";
