import type { z } from "zod";
import type { sendDocumentSchema } from "../../parsing/send-document";
import type { Company } from "@peppol/data/companies";
import type { Attachment } from "@peppol/utils/parsing/invoice/schemas";
import type { AddressableParty } from "@peppol/utils/identifiers/electronic-address";
import type { Discrepancy, Finding, Issue } from "@peppol/types/intake";
import type { DocumentTypeKey } from "./keys";

export type {
  BillingDocumentTypeKey,
  DocumentTypeKey,
  OperationalDocumentTypeKey,
  ParsedOrUnknownDocumentType,
  ReportingDocumentTypeKey,
  StoredDocumentType,
  TransactionMessagingDocumentTypeKey,
} from "./keys";

export type DocumentTypeClass =
  | "billing"
  | "transactionMessaging"
  | "reporting"
  | "operational";

export type DocumentDetails = {
  documentNumber?: string;
  amount?: string;
  currency?: string;
  senderName?: string;
  /** The issuer's email address as the document states it, where a reply to the document belongs. */
  senderEmail?: string;
  receiverName?: string;
  /** The receiving party's field in the document, such as "buyer", for error messages. */
  receiverRole?: string;
  /**
   * The receiving party's numbers, which give the electronic address a structured
   * document delivered by email alone names for it, since it has no Peppol recipient.
   * Null for a party identified by party identifiers alone when it has none.
   */
  receiverAddressable?: AddressableParty;
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
 * What document intake needs to extract a type from a PDF with a model, beyond the
 * type's schema. Every function gets the document as the model wrote it, or as the
 * schema parsed it, and must not throw on a value of an unexpected shape.
 */
export type AiIntakeRules = {
  /** Extraction rules for the model, next to the rules for every type. */
  instructions: string[];
  /** Write an extracted document in the form that the schema requires, before it is parsed. */
  normalize?: (document: unknown) => unknown;
  /** What a parsed document must contain to be published, next to its number and sender. */
  minimumEvidence?: (document: unknown) => Issue[];
  /**
   * Correct a value that a model misreads in a known way, when the document's own
   * other values show the correct one. Each correction is reported as a finding.
   */
  reconcile?: (document: unknown) => { document: unknown; findings: Finding[] };
  /**
   * Values of a parsed document that the schema accepts but the type does not, such as
   * a VAT category with a rate it cannot have. `text` is the text layer of the PDF, when
   * it has one. The model is asked to correct them; what remains is published as a finding.
   */
  issues?: (document: unknown, context: { text?: string }) => Issue[];
};

/**
 * The canonical document a schema describes, once parsed. Every member reads
 * one: `documentSchema` is the full document, and `sendSchema` is that same schema
 * with the fields the send API lets a caller omit loosened, so a document only
 * becomes canonical once `preprocessFromSendAPI` has filled them in.
 */
type ParsedDocument<Schema extends z.ZodSchema> = z.infer<Schema>;

export type DocumentType<SendSchema extends z.ZodSchema, DocumentSchema extends z.ZodSchema> = {
  key: DocumentTypeKey;
  translatableTitle: string;
  class: DocumentTypeClass;
  /**
   * How document intake extracts this type from a PDF with a model, or null when it
   * may not recognise the type in a PDF.
   */
  aiIntake: AiIntakeRules | null;
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
  /**
   * The values a parsed document states that its own other values contradict, for
   * example totals that do not add up. A document of a received format and an
   * extracted document are checked alike.
   */
  checkConsistency?: (document: ParsedDocument<DocumentSchema>) => Discrepancy[];
};

export type AnyDocumentType = DocumentType<z.ZodSchema, z.ZodSchema>;

export type ParsedDocumentOf<T extends AnyDocumentType> = z.infer<T["documentSchema"]>;

export type RawDocumentOf<T extends AnyDocumentType> = z.input<T["documentSchema"]>;
