import { ensureFileExtension } from "@peppol/utils/document-filename";
import type { Attachment } from "@peppol/utils/parsing/invoice/schemas";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";

type RepositoryPdfOptions = {
  customPdfFilename?: string;
  pdfa?: boolean;
};

export async function generateAndAttachRepositoryPdf(
  documentId: string,
  documentType: AnyDocumentType,
  documentToRender: any,
  documentToAttachTo: any,
  options: RepositoryPdfOptions = {},
): Promise<any> {
  if (!documentType.pdfGeneration) {
    throw new Error(`PDF generation is not supported for ${documentType.key}.`);
  }

  const filename = ensureFileExtension(
    options.customPdfFilename ||
      documentType.generateFilename(documentToRender),
    "pdf",
  );
  const pdf = await documentType.render(
    documentToRender,
    { format: "pdf", pdfa: options.pdfa },
    { documentId },
  );
  return documentType.pdfGeneration.attachGeneratedPdf(documentToAttachTo, {
    id: filename,
    filename,
    mimeCode: "application/pdf",
    description: null,
    embeddedDocument: Buffer.from(pdf).toString("base64"),
    url: null,
  });
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
