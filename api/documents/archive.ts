import JSZip from "jszip";
import { renderDocumentPdf } from "@peppol/utils/document-renderer";
import type { PublicTransmittedDocumentWithLabels } from "@peppol/data/transmitted-documents";
import {
  hydrateDocumentParsedAttachments,
  resolveDocumentXml,
  resolveDocumentXmlAndAttachments,
} from "@peppol/data/offload/storage";
import { S3_REQUEST_CONCURRENCY, mapWithConcurrency } from "@peppol/utils/concurrency";

export async function buildDocumentsArchive(
  documents: PublicTransmittedDocumentWithLabels[],
  options: {
    outputType: "flat" | "nested";
    generatePdf: "never" | "always" | "when_no_pdf_attachment";
  }
) {
  const zip = new JSZip();

  if (options.outputType === "flat") {
    await mapWithConcurrency(documents, S3_REQUEST_CONCURRENCY, async (document) => {
      const xml = await resolveDocumentXml(document);
      if (xml) {
        zip.file(`${document.id}.xml`, xml);
      } else {
        const pdfBuffer = await renderDocumentPdf(document);
        zip.file(`${document.id}.pdf`, pdfBuffer);
      }
    });

    return zip.generateAsync({ type: "nodebuffer" });
  }

  await mapWithConcurrency(documents, S3_REQUEST_CONCURRENCY, async (document) => {
    const folder = zip.folder(document.id);

    if (!folder) {
      return;
    }

    const { xml, attachments } = await resolveDocumentXmlAndAttachments(document);

    const parsed = hydrateDocumentParsedAttachments(document.parsed, attachments);
    const { xml: _xml, ...documentMetadata } = { ...document, parsed };
    folder.file("document.json", JSON.stringify(documentMetadata, null, 2));

    if (xml) {
      folder.file("document.xml", xml);
    }

    let hasPdfAttachment = false;

    if (attachments) {
      for (const attachment of attachments) {
        const base64 = attachment.embeddedDocument;
        const mimeCode = attachment.mimeCode;
        const filename = attachment.filename;

        if (base64 && mimeCode && filename) {
          folder.file(filename, Buffer.from(base64, "base64"));

          if (mimeCode === "application/pdf") {
            hasPdfAttachment = true;
          }
        }
      }
    }

    const shouldGeneratePdf =
      options.generatePdf === "always" ||
      (options.generatePdf === "when_no_pdf_attachment" && !hasPdfAttachment);

    if (!shouldGeneratePdf) {
      return;
    }

    try {
      const pdfBuffer = await renderDocumentPdf(document);
      folder.file("auto-generated.pdf", pdfBuffer);
    } catch (error) {
      console.error(`Failed to generate PDF for document ${document.id}:`, error);
    }
  });

  return zip.generateAsync({ type: "nodebuffer" });
}
