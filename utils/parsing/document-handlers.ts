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
import { franceCdarToXML } from "./france-cdar/to-xml";
import { parseFranceCdarFromXML } from "./france-cdar/from-xml";
import { invoiceToCII } from "./invoice/cii-d22b/to-xml";
import { parseInvoiceFromCII } from "./invoice/cii-d22b/from-xml";
import { creditNoteToCII } from "./creditnote/cii-d22b/to-xml";
import { parseCreditNoteFromCII } from "./creditnote/cii-d22b/from-xml";
import { frenchRegulatedInvoiceToCII } from "./invoice/cii-d22b-france-regulated/to-xml";
import { parseFrenchRegulatedInvoiceFromCII } from "./invoice/cii-d22b-france-regulated/from-xml";
import { frenchRegulatedCreditNoteToCII } from "./creditnote/cii-d22b-france-regulated/to-xml";
import { parseFrenchRegulatedCreditNoteFromCII } from "./creditnote/cii-d22b-france-regulated/from-xml";
import { frenchRegulatedInvoiceToUBL } from "./invoice/ubl-france-regulated/to-xml";
import { parseFrenchRegulatedInvoiceFromUBL } from "./invoice/ubl-france-regulated/from-xml";
import { frenchRegulatedCreditNoteToUBL } from "./creditnote/ubl-france-regulated/to-xml";
import { parseFrenchRegulatedCreditNoteFromUBL } from "./creditnote/ubl-france-regulated/from-xml";
import {
  CII_EN16931_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
  CII_EN16931_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
  CII_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO,
  CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
  CREDIT_NOTE_DOCUMENT_TYPE_INFO,
  FRANCE_CDAR_DOCUMENT_TYPE_INFO,
  INVOICE_DOCUMENT_TYPE_INFO,
  MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO,
  SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
  SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO,
  UBL_FRANCE_CREDIT_NOTE_CIUS_DOCUMENT_TYPE_INFO,
  UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO,
  UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO,
  UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
  type DocumentTypeInfo,
  type SupportedDocumentType,
} from "@peppol/utils/document-types";
import type { Invoice } from "./invoice/schemas";
import type { CreditNote } from "./creditnote/schemas";
import type { SelfBillingInvoice } from "./self-billing-invoice/schemas";
import type { SelfBillingCreditNote } from "./self-billing-creditnote/schemas";
import type { MessageLevelResponse } from "./message-level-response/schemas";
import type { FranceCdar } from "./france-cdar/schemas";
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

function isFrenchRegulatedUblDocType(docTypeId: string): boolean {
  return docTypeId === UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO.docTypeId ||
    docTypeId === UBL_FRANCE_CREDIT_NOTE_CIUS_DOCUMENT_TYPE_INFO.docTypeId ||
    docTypeId === UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId ||
    docTypeId === UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId;
}

export const DOCUMENT_XML_HANDLERS: DocumentXmlHandler[] = [
  {
    ...INVOICE_DOCUMENT_TYPE_INFO,
    type: "invoice",
    matchesDocTypeId: (docTypeId) => isUblInvoiceDocType(docTypeId) && !isSelfBillingDocType(docTypeId) && !isFrenchRegulatedUblDocType(docTypeId),
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
    matchesDocTypeId: (docTypeId) => isUblCreditNoteDocType(docTypeId) && !isSelfBillingDocType(docTypeId) && !isFrenchRegulatedUblDocType(docTypeId),
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
    ...FRANCE_CDAR_DOCUMENT_TYPE_INFO,
    type: "frenchInvoicingCdar",
    matchesDocTypeId: (docTypeId) => docTypeId === FRANCE_CDAR_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document }) =>
      franceCdarToXML({
        franceCdar: document as FranceCdar,
      }),
    fromXml: (xml) => parseFranceCdarFromXML(xml),
  },
  {
    ...CII_EN16931_INVOICE_D22B_DOCUMENT_TYPE_INFO,
    type: "invoice",
    matchesDocTypeId: (docTypeId) => docTypeId === CII_EN16931_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      invoiceToCII({
        invoice: document as Invoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }),
    fromXml: (xml) => parseInvoiceFromCII(xml),
  },
  {
    ...UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO,
    type: "invoice",
    matchesDocTypeId: (docTypeId) => docTypeId === UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      frenchRegulatedInvoiceToUBL({
        invoice: document as Invoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }),
    fromXml: (xml) => parseFrenchRegulatedInvoiceFromUBL(xml),
  },
  {
    ...UBL_FRANCE_CREDIT_NOTE_CIUS_DOCUMENT_TYPE_INFO,
    type: "creditNote",
    matchesDocTypeId: (docTypeId) => docTypeId === UBL_FRANCE_CREDIT_NOTE_CIUS_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      frenchRegulatedCreditNoteToUBL({
        creditNote: document as CreditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }),
    fromXml: (xml) => parseFrenchRegulatedCreditNoteFromUBL(xml),
  },
  {
    ...CII_EN16931_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
    type: "creditNote",
    matchesDocTypeId: (docTypeId) => docTypeId === CII_EN16931_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      creditNoteToCII({
        creditNote: document as CreditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }),
    fromXml: (xml) => parseCreditNoteFromCII(xml),
  },
  {
    ...CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
    type: "invoice",
    matchesDocTypeId: (docTypeId) => docTypeId === CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      frenchRegulatedInvoiceToCII({
        invoice: document as Invoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
        documentTypeInfo: CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
      }),
    fromXml: (xml) => parseFrenchRegulatedInvoiceFromCII(xml),
  },
  {
    ...CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
    type: "creditNote",
    matchesDocTypeId: (docTypeId) => docTypeId === CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      frenchRegulatedCreditNoteToCII({
        creditNote: document as CreditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
        documentTypeInfo: CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
      }),
    fromXml: (xml) => parseFrenchRegulatedCreditNoteFromCII(xml),
  },
  {
    ...UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
    type: "invoice",
    matchesDocTypeId: (docTypeId) => docTypeId === UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      frenchRegulatedInvoiceToUBL({
        invoice: document as Invoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
        documentTypeInfo: UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
      }),
    fromXml: (xml) => parseFrenchRegulatedInvoiceFromUBL(xml),
  },
  {
    ...UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO,
    type: "creditNote",
    matchesDocTypeId: (docTypeId) => docTypeId === UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      frenchRegulatedCreditNoteToUBL({
        creditNote: document as CreditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
        documentTypeInfo: UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO,
      }),
    fromXml: (xml) => parseFrenchRegulatedCreditNoteFromUBL(xml),
  },
  {
    ...CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
    type: "invoice",
    matchesDocTypeId: (docTypeId) => docTypeId === CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      frenchRegulatedInvoiceToCII({
        invoice: document as Invoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
        documentTypeInfo: CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
      }),
    fromXml: (xml) => parseFrenchRegulatedInvoiceFromCII(xml),
  },
  {
    ...CII_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO,
    type: "creditNote",
    matchesDocTypeId: (docTypeId) => docTypeId === CII_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId,
    toXml: ({ document, senderAddress, recipientAddress, isDocumentValidationEnforced }) =>
      frenchRegulatedCreditNoteToCII({
        creditNote: document as CreditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
        documentTypeInfo: CII_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO,
      }),
    fromXml: (xml) => parseFrenchRegulatedCreditNoteFromCII(xml),
  },
];

export function getDocumentXmlHandlersByDocTypeId(docTypeId: string): DocumentXmlHandler[] {
  return DOCUMENT_XML_HANDLERS.filter((handler) => handler.matchesDocTypeId(docTypeId));
}

export function resolveDocumentXmlHandler(
  docTypeId: string,
  expectedType: SupportedDocumentType
): { ok: true; handler: DocumentXmlHandler } | { ok: false; message: string } {
  const handlers = getDocumentXmlHandlersByDocTypeId(docTypeId);
  const handler = handlers.find((candidate) => candidate.type === expectedType);
  if (!handler) {
    if (handlers.length > 0) {
      return {
        ok: false,
        message: `Document type identifier '${docTypeId}' does not match documentType '${expectedType}'.`,
      };
    }
    return {
      ok: false,
      message: `Document type identifier '${docTypeId}' is not supported for JSON document conversion.`,
    };
  }
  return { ok: true, handler };
}
