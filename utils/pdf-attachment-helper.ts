import { renderDocumentPdf } from "@peppol/utils/document-renderer";
import {
  ensureFileExtension,
  getDocumentFilename,
  type ParsedDocument,
} from "@peppol/utils/document-filename";
import type { SupportedDocumentType } from "@peppol/utils/document-types";
import type { Attachment } from "@peppol/utils/parsing/invoice/schemas";

type GenerateAndAttachPdfOptions = {
  customPdfFilename?: string;
  pdfa?: boolean;
};

export async function generateAndAttachPdf(
  documentId: string,
  documentType: SupportedDocumentType,
  document: any,
  attachments: Attachment[] | null | undefined,
  options: GenerateAndAttachPdfOptions = {}
): Promise<Attachment[]> {
  const pdfFilename = options.customPdfFilename
    ? ensureFileExtension(options.customPdfFilename, "pdf")
    : ensureFileExtension(
        getDocumentFilename(documentType, document as ParsedDocument | null),
        "pdf"
      );

  const pdfBuffer = await renderDocumentPdf({
    id: documentId,
    type: documentType,
    parsed: document,
  } as any, { pdfa: options.pdfa });

  const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");
  const existingAttachments = Array.isArray(attachments)
    ? (attachments as Attachment[])
    : [];

  const nextAttachments = existingAttachments.filter(
    (a: Attachment) => a.filename !== pdfFilename && a.id !== pdfFilename
  );

  nextAttachments.push({
    id: pdfFilename,
    filename: pdfFilename,
    mimeCode: "application/pdf",
    description: null,
    embeddedDocument: pdfBase64,
    url: null,
  });

  return nextAttachments;
}

export function findFirstEmbeddedPdfAttachment(
  attachments: Attachment[] | null | undefined
): Attachment | null {
  if (!Array.isArray(attachments)) {
    return null;
  }
  return (
    attachments.find(
      (attachment) =>
        attachment.embeddedDocument &&
        (attachment.mimeCode === "application/pdf" ||
          attachment.filename.toLowerCase().endsWith(".pdf"))
    ) ?? null
  );
}
