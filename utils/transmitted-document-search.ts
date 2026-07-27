import type { ParsedDocument } from "@peppol/utils/document-filename";
import {
  isReportingDocumentType,
  type SupportedDocumentType,
} from "@peppol/utils/document-types";

export type TransmittedDocumentSearchFields = {
  senderName: string | null;
  receiverName: string | null;
  documentNumber: string | null;
  searchText: string;
};

type SearchableParsedDocument = ParsedDocument & {
  seller?: { name?: string | null } | null;
  buyer?: { name?: string | null } | null;
  invoiceNumber?: string | null;
  creditNoteNumber?: string | null;
  reference?: string | null;
};

function normalizeSearchValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => normalizeSearchValue(part))
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

export function getTransmittedDocumentSearchFields({
  id,
  senderId,
  receiverId,
  docTypeId,
  processId,
  countryC1,
  type,
  parsedDocument,
}: {
  id: string;
  senderId: string;
  receiverId: string | null;
  docTypeId: string;
  processId: string;
  countryC1: string;
  type: SupportedDocumentType;
  parsedDocument: ParsedDocument | null | undefined;
}): TransmittedDocumentSearchFields {
  const parsed = parsedDocument as SearchableParsedDocument | null | undefined;

  const senderName =
    type === "invoice" || type === "creditNote"
      ? parsed?.seller?.name
      : type === "selfBillingInvoice" || type === "selfBillingCreditNote"
        ? parsed?.buyer?.name
        : null;

  const receiverName =
    type === "invoice" || type === "creditNote"
      ? parsed?.buyer?.name
      : type === "selfBillingInvoice" || type === "selfBillingCreditNote"
        ? parsed?.seller?.name
        : null;

  const documentNumber =
    type === "invoice" || type === "selfBillingInvoice"
      ? parsed?.invoiceNumber
      : type === "creditNote" || type === "selfBillingCreditNote"
        ? parsed?.creditNoteNumber
        : type === "frenchInvoicingCdar"
          ? (parsed as { invoiceId?: string | null } | null | undefined)?.invoiceId
          : isReportingDocumentType(type)
            ? parsed?.reference
            : null;

  const normalizedSenderName = normalizeSearchValue(senderName);
  const normalizedReceiverName = normalizeSearchValue(receiverName);
  const normalizedDocumentNumber = normalizeSearchValue(documentNumber);

  return {
    senderName: normalizedSenderName,
    receiverName: normalizedReceiverName,
    documentNumber: normalizedDocumentNumber,
    searchText: buildSearchText([
      id,
      senderId,
      receiverId,
      docTypeId,
      processId,
      countryC1,
      normalizedSenderName,
      normalizedReceiverName,
      normalizedDocumentNumber,
    ]),
  };
}
