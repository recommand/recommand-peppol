import type {
  AnyDocumentType,
  ParsedDocumentOf,
  RawDocumentOf,
} from "../document-types/types";
import type { ParsedXmlDocument } from "./xml-detection";

type EncodeContext = {
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
};

/**
 * A binary envelope around the XML — today only Factur-X, which carries a CII document
 * inside a PDF/A-3 file. The container is what travels over the network and what is
 * archived as the original payload; the XML stays what is validated, parsed and stored.
 * A format without a container is an XML format, end to end.
 */
export type DocumentContainer<Document> = {
  contentType: string;
  containerFormat: "pdf";
  requiresPdfA: boolean;
  wrap: (options: {
    xmlDocument: string;
    document: Document;
  }) => Promise<Buffer>;
  unwrap: (payload: Buffer) => Promise<string>;
};

/**
 * One Peppol document type identifier: the syntax a document is written in, the
 * processes it travels over, and the document types it can carry.
 *
 * Parameterised by the document types rather than by a schema pair, because a format
 * may carry more than one of them and they do not share schemas. Listing a document
 * type therefore widens what `encode` accepts and what `decode` returns, which is what
 * keeps the two in step with `supportedDocumentTypes`.
 */
export type DocumentFormat<DocumentTypes extends readonly AnyDocumentType[]> = {
  key: string;
  translatableTitle: string;

  docTypeId: string;
  supportedDocumentTypes: DocumentTypes;
  supportedProcessIds: string[];
  resolveProcessId?: (
    document: ParsedDocumentOf<DocumentTypes[number]>
  ) => string;

  encode: (
    document: ParsedDocumentOf<DocumentTypes[number]>,
    processId: string,
    context: EncodeContext
  ) => string;
  decode: (
    raw: string | Buffer,
    processId: string
  ) => RawDocumentOf<DocumentTypes[number]>;
  detectDocumentType: (raw: string | Buffer) => DocumentTypes[number];

  isFormat?: (document: ParsedXmlDocument) => boolean;

  /** Absent for the XML formats, which are transmitted as the bytes `encode` returns. */
  container?: DocumentContainer<ParsedDocumentOf<DocumentTypes[number]>>;
}

export type AnyDocumentFormat = DocumentFormat<readonly AnyDocumentType[]>;
