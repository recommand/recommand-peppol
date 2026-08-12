import type { z } from "zod";
import type { sendDocumentSchema } from "../../parsing/send-document";
import type { Company } from "@peppol/data/companies";
import type { Attachment } from "@peppol/utils/parsing/invoice/schemas";

export type DocumentTypeClass = "billing" | "transactionMessaging" | "reporting";

export type DocumentTypeKey =
  | "invoice"
  | "creditNote"
  | "selfBillingInvoice"
  | "selfBillingCreditNote"
  | "messageLevelResponse"
  | "frenchInvoicingCdar"
  | "frenchB2CSalesReport"
  | "frenchB2CPaymentReport";

export type StoredDocumentType = DocumentTypeKey | "invoiceResponse" | "unknown";

export type DocumentDetails = {
  documentNumber?: string;
  amount?: string;
  currency?: string;
  senderName?: string;
  receiverName?: string;
};

export type SendPreprocessContext = {
  company: Company;
};

export type RenderContext = {
  documentId: string;
};

/**
 * Who the document is from and to, as named by the document itself. Self-billing
 * types reverse the roles, so this is per document type rather than derived from
 * the seller/buyer fields directly. Null when the document names no such party.
 */
export type DocumentCounterparties = {
  senderName: string | null;
  receiverName: string | null;
};

export type RenderFormat = "html" | "pdf";
export type RenderResult<F extends RenderFormat> = F extends "pdf"
  ? Buffer
  : string;

/**
 * The canonical document a schema describes, once parsed. Every member reads
 * one: `documentSchema` is the full document, and `sendSchema` is that same schema
 * with the fields the send API lets a caller omit loosened, so a document only
 * becomes canonical once `preprocessFromSendAPI` has filled them in.
 */
type ParsedDocument<Schema extends z.ZodSchema> = z.infer<Schema>;

export type DocumentType<SendSchema extends z.ZodSchema, DocumentSchema extends z.ZodSchema> = {
  key: string;
  translatableTitle: string;
  class: DocumentTypeClass;
  sendSchema: SendSchema;
  documentSchema: DocumentSchema;
  preprocessFromSendAPI: (
    data: z.input<typeof sendDocumentSchema>,
    context: SendPreprocessContext
  ) => z.output<SendSchema>;
  render: <F extends RenderFormat>(
    document: ParsedDocument<DocumentSchema>,
    options: { format: F; pdfa?: boolean },
    context: RenderContext
  ) => Promise<RenderResult<F>>;
  generateFilename: (document: ParsedDocument<DocumentSchema>) => string;
  pdfGeneration: {
    attachGeneratedPdf: (
      document: ParsedDocument<DocumentSchema>,
      attachment: Attachment
    ) => ParsedDocument<DocumentSchema>;
  } | undefined;
  email: {
    isEmailDeliverySupported: boolean;
    areEmailNotificationsSupported: boolean;
    extractDocumentDetails: (
      document: ParsedDocument<DocumentSchema>
    ) => DocumentDetails;
  } | undefined;
  extractCounterparties: (
    document: ParsedDocument<DocumentSchema>
  ) => DocumentCounterparties;
  extractSearchableText: (document: ParsedDocument<DocumentSchema>) => string;
  extractDocumentNumber: (
    document: ParsedDocument<DocumentSchema>
  ) => string | null;
};

export type AnyDocumentType = DocumentType<z.ZodSchema, z.ZodSchema>;

export type ParsedDocumentOf<T extends AnyDocumentType> = z.infer<T["documentSchema"]>;

export type RawDocumentOf<T extends AnyDocumentType> = z.input<T["documentSchema"]>;
