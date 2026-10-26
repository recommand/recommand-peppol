import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { db } from "@recommand/db";
import { transmittedDocuments } from "@peppol/db/schema";
import { renderDocumentPdf } from "@peppol/utils/document-renderer";
import { resolveDocumentXmlAndAttachments } from "@peppol/data/offload/storage";

/**
 * A zip with a document's XML, its attachments and, if asked, a rendered PDF.
 * Looks the document up by id alone: the caller decides who may download it.
 * Null when there is no such document.
 */
export async function buildDocumentFilesArchive(
  documentId: string,
  generatePdf: "never" | "always" | "when_no_pdf_attachment"
): Promise<Buffer | null> {
  const [document] = await db
    .select()
    .from(transmittedDocuments)
    .where(eq(transmittedDocuments.id, documentId))
    .limit(1);

  if (!document) {
    return null;
  }

  const zip = new JSZip();

  const { xml, attachments } = await resolveDocumentXmlAndAttachments(document);
  if (xml) {
    zip.file("document.xml", xml);
  }

  let hasPdfAttachment = false;
  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      const base64 = attachment.embeddedDocument;
      const mimeCode = attachment.mimeCode;
      const filename = attachment.filename;

      if (base64 && mimeCode && filename) {
        zip.file(filename, Buffer.from(base64, "base64"));
        if (mimeCode === "application/pdf") {
          hasPdfAttachment = true;
        }
      }
    }
  }

  const shouldGeneratePdf =
    generatePdf === "always" || (generatePdf === "when_no_pdf_attachment" && !hasPdfAttachment);

  if (shouldGeneratePdf) {
    try {
      const pdfBuffer = await renderDocumentPdf(document as any);
      zip.file("auto-generated.pdf", pdfBuffer);
    } catch (error) {
      console.error("Failed to generate PDF for document files archive:", error);
    }
  }

  return await zip.generateAsync({ type: "nodebuffer" });
}
