import {
  CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  type SupportedDocumentType,
} from "@peppol/utils/document-types";
import {
  type DocumentXmlHandler,
  resolveDocumentXmlHandler,
} from "@peppol/utils/parsing/document-handlers";
import type { ParsedDocument } from "@peppol/utils/document-filename";
import type { Attachment, Invoice } from "@peppol/utils/parsing/invoice/schemas";
import { findFirstEmbeddedPdfAttachment } from "@peppol/utils/pdf-attachment-helper";
import { generateFacturXDocument } from "@peppol/data/factur-x/client";
import { invoiceToCII } from "@peppol/utils/parsing/invoice/cii-d22b/to-xml";

type OutgoingDocumentXmlResolution = {
  handler: DocumentXmlHandler;
  parseDocTypeId: string;
};

type OutgoingDocumentPayload = {
  body: string | Blob;
  contentType: string;
  processId?: string;
};

type BinaryDocumentFormat = {
  docTypeId: string;
  sourceDocTypeId: string;
  requiresPdfA: boolean;
  resolveXmlHandler?: (handler: DocumentXmlHandler) => DocumentXmlHandler;
  resolvePayload: (options: {
    xmlDocument: string;
    parsedDocument: ParsedDocument;
  }) => Promise<OutgoingDocumentPayload>;
};

const FACTURX_EN16931_GUIDELINE_ID = "urn:cen.eu:en16931:2017";

function getDocumentAttachments(document: ParsedDocument): Attachment[] {
  if ("attachments" in document && Array.isArray(document.attachments)) {
    return document.attachments as Attachment[];
  }
  return [];
}

function bufferToBlob(buffer: Buffer, contentType: string): Blob {
  return new Blob(
    [
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer,
    ],
    { type: contentType }
  );
}

const BINARY_DOCUMENT_FORMATS: BinaryDocumentFormat[] = [
  {
    docTypeId: FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    sourceDocTypeId: CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    requiresPdfA: true,
    resolveXmlHandler: (handler) => ({
      ...handler,
      toXml: ({
        document,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
      }) =>
        invoiceToCII({
          invoice: document as Invoice,
          senderAddress,
          recipientAddress,
          isDocumentValidationEnforced,
          guidelineId: FACTURX_EN16931_GUIDELINE_ID,
        }),
    }),
    resolvePayload: async ({
      xmlDocument,
      parsedDocument,
    }) => {
      const attachments = getDocumentAttachments(parsedDocument);
      const basePdfAttachment = findFirstEmbeddedPdfAttachment(attachments);
      if (!basePdfAttachment) {
        throw new Error(
          "Factur-X invoice sending requires an embedded PDF attachment or enabled PDF generation."
        );
      }

      const facturXDocument = await generateFacturXDocument({
        xmlDocument,
        pdf: {
          filename: basePdfAttachment.filename,
          mimeCode: basePdfAttachment.mimeCode,
          content: Buffer.from(basePdfAttachment.embeddedDocument!, "base64"),
        },
      });
      return {
        body: bufferToBlob(facturXDocument, "application/pdf"),
        contentType: "application/pdf",
        processId: FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.processId,
      };
    },
  },
];

function getBinaryDocumentFormat(docTypeId: string): BinaryDocumentFormat | null {
  return (
    BINARY_DOCUMENT_FORMATS.find((format) => format.docTypeId === docTypeId) ??
    null
  );
}

export function resolveOutgoingDocumentXmlHandler(
  docTypeId: string,
  expectedType: SupportedDocumentType
):
  | { ok: true; resolution: OutgoingDocumentXmlResolution }
  | { ok: false; message: string } {
  const binaryFormat = getBinaryDocumentFormat(docTypeId);
  const sourceDocTypeId = binaryFormat?.sourceDocTypeId ?? docTypeId;
  const resolvedHandler = resolveDocumentXmlHandler(
    sourceDocTypeId,
    expectedType
  );
  if (!resolvedHandler.ok) {
    return resolvedHandler;
  }
  return {
    ok: true,
    resolution: {
      handler:
        binaryFormat?.resolveXmlHandler?.(resolvedHandler.handler) ??
        resolvedHandler.handler,
      parseDocTypeId: sourceDocTypeId,
    },
  };
}

export async function prepareOutgoingDocumentPayload(options: {
  docTypeId: string;
  xmlDocument: string;
  parsedDocument: ParsedDocument;
}): Promise<OutgoingDocumentPayload> {
  const binaryFormat = getBinaryDocumentFormat(options.docTypeId);
  if (binaryFormat) {
    return binaryFormat.resolvePayload(options);
  }
  return {
    body: options.xmlDocument,
    contentType: "application/xml",
  };
}

export function requiresPdfAForGeneratedPdf(docTypeId: string): boolean {
  return getBinaryDocumentFormat(docTypeId)?.requiresPdfA ?? false;
}
