import { invoiceToUBL } from "./invoice/peppol-ubl-bis3/to-xml";
import { parseInvoiceFromXML } from "./invoice/peppol-ubl-bis3/from-xml";
import { creditNoteToUBL } from "./creditnote/peppol-ubl-bis3/to-xml";
import { parseCreditNoteFromXML } from "./creditnote/peppol-ubl-bis3/from-xml";
import { selfBillingInvoiceToUBL } from "./self-billing-invoice/to-xml";
import { parseSelfBillingInvoiceFromXML } from "./self-billing-invoice/from-xml";
import { selfBillingCreditNoteToUBL } from "./self-billing-creditnote/to-xml";
import { parseSelfBillingCreditNoteFromXML } from "./self-billing-creditnote/from-xml";
import { messageLevelResponseToXML } from "./message-level-response/to-xml";
import { parseMessageLevelResponseFromXML } from "./message-level-response/from-xml";
import { invoiceToCII } from "./invoice/cii-d22b/to-xml";
import { parseInvoiceFromCII } from "./invoice/cii-d22b/from-xml";
import {
  CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  CREDIT_NOTE_DOCUMENT_TYPE_INFO,
  INVOICE_DOCUMENT_TYPE_INFO,
  MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO,
  SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
  SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO,
  type DocumentTypeInfo,
  type SupportedDocumentType,
} from "@peppol/utils/document-types";
import type { Invoice } from "./invoice/schemas";
import type { CreditNote } from "./creditnote/schemas";
import type { SelfBillingInvoice } from "./self-billing-invoice/schemas";
import type { SelfBillingCreditNote } from "./self-billing-creditnote/schemas";
import type { MessageLevelResponse } from "./message-level-response/schemas";
import type { ParsedDocument } from "@peppol/utils/document-filename";

type ToXmlOptions = {
  document: ParsedDocument;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
};

export type DocumentXmlHandler = Omit<DocumentTypeInfo, "type"> & {
  type: SupportedDocumentType;
  matchesDocTypeId: (docTypeId: string) => boolean;
  toXml: (options: ToXmlOptions) => string;
  fromXml: (xml: string) => ParsedDocument;
};

function isUblInvoiceDocType(docTypeId: string): boolean {
  return docTypeId.startsWith("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##");
}

function isUblCreditNoteDocType(docTypeId: string): boolean {
  return docTypeId.startsWith("urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##");
}

function isSelfBillingDocType(docTypeId: string): boolean {
  return docTypeId.includes("urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0");
}

export const DOCUMENT_XML_HANDLERS: DocumentXmlHandler[] = [
  {
    ...INVOICE_DOCUMENT_TYPE_INFO,
    type: "invoice",
    matchesDocTypeId: (docTypeId) => isUblInvoiceDocType(docTypeId) && !isSelfBillingDocType(docTypeId),
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      invoiceToUBL({
        invoice: document as Invoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }),
    fromXml: (xml) => parseInvoiceFromXML(xml),
  },
  {
    ...CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    type: "creditNote",
    matchesDocTypeId: (docTypeId) => isUblCreditNoteDocType(docTypeId) && !isSelfBillingDocType(docTypeId),
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      creditNoteToUBL({
        creditNote: document as CreditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }),
    fromXml: (xml) => parseCreditNoteFromXML(xml),
  },
  {
    ...SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO,
    type: "selfBillingInvoice",
    matchesDocTypeId: (docTypeId) => isUblInvoiceDocType(docTypeId) && isSelfBillingDocType(docTypeId),
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      selfBillingInvoiceToUBL({
        selfBillingInvoice: document as SelfBillingInvoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }),
    fromXml: (xml) => parseSelfBillingInvoiceFromXML(xml),
  },
  {
    ...SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    type: "selfBillingCreditNote",
    matchesDocTypeId: (docTypeId) => isUblCreditNoteDocType(docTypeId) && isSelfBillingDocType(docTypeId),
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      selfBillingCreditNoteToUBL({
        selfBillingCreditNote: document as SelfBillingCreditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }),
    fromXml: (xml) => parseSelfBillingCreditNoteFromXML(xml),
  },
  {
    ...MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO,
    type: "messageLevelResponse",
    matchesDocTypeId: (docTypeId) => docTypeId === MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress }) =>
      messageLevelResponseToXML({
        messageLevelResponse: document as MessageLevelResponse,
        senderAddress,
        recipientAddress,
      }),
    fromXml: (xml) => parseMessageLevelResponseFromXML(xml),
  },
  {
    ...CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
    type: "invoice",
    matchesDocTypeId: (docTypeId) => docTypeId === CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      invoiceToCII({
        invoice: document as Invoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }),
    fromXml: (xml) => parseInvoiceFromCII(xml),
  },
];

export function getDocumentXmlHandlerByDocTypeId(docTypeId: string): DocumentXmlHandler | undefined {
  return DOCUMENT_XML_HANDLERS.find((handler) => handler.matchesDocTypeId(docTypeId));
}

export function resolveDocumentXmlHandler(
  docTypeId: string,
  expectedType: SupportedDocumentType
): { ok: true; handler: DocumentXmlHandler } | { ok: false; message: string } {
  const handler = getDocumentXmlHandlerByDocTypeId(docTypeId);
  if (!handler) {
    return {
      ok: false,
      message: `Document type identifier '${docTypeId}' is not supported for JSON document conversion.`,
    };
  }
  if (handler.type !== expectedType) {
    return {
      ok: false,
      message: `Document type identifier '${docTypeId}' does not match documentType '${expectedType}'.`,
    };
  }
  return { ok: true, handler };
}