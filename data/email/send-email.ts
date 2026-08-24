import { sendEmail } from "@core/lib/email";
import { Attachment } from "postmark";
import type { StoredDocumentType } from "@peppol/utils/type-repository/document-types/types";
import {
  getDocumentFilename,
  type ParsedDocument,
} from "@peppol/utils/document-filename";
import { extractDocumentAttachments } from "@peppol/data/email/document-attachments";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";

export { extractDocumentAttachments } from "@peppol/data/email/document-attachments";

export async function sendDocumentEmail(options: {
  type: StoredDocumentType;
  parsedDocument: ParsedDocument | null;
  xmlDocument: string | null;
  to: string;
  subject?: string;
  htmlBody?: string;
  isPlayground?: boolean;
}) {
  let senderName = "";
  const documentType = getDocumentType(options.type);
  const documentTypeTitle = documentType?.translatableTitle ?? "Document";
  const filename = getDocumentFilename(options.type, options.parsedDocument);
  let subject = options.subject;
  let htmlBody = options.htmlBody;

  // Only a billing document names a seller alongside its document number; a
  // report carries a document number too, but about the document it reports on.
  if (!subject) {
    if (
      options.parsedDocument &&
      "seller" in options.parsedDocument &&
      "invoiceNumber" in options.parsedDocument
    ) {
      subject = `${documentTypeTitle} ${options.parsedDocument.invoiceNumber}`;
      senderName = options.parsedDocument.seller.name;
    } else if (
      options.parsedDocument &&
      "seller" in options.parsedDocument &&
      "creditNoteNumber" in options.parsedDocument
    ) {
      subject = `${documentTypeTitle} ${options.parsedDocument.creditNoteNumber}`;
      senderName = options.parsedDocument.seller.name;
    } else {
      subject = documentTypeTitle;
    }
  }

  if (!htmlBody) {
    const documentTypeTitleLowercase = documentTypeTitle.toLowerCase();
    if (
      options.parsedDocument &&
      "seller" in options.parsedDocument &&
      "buyer" in options.parsedDocument &&
      options.parsedDocument.buyer?.name
    ) {
      htmlBody = `Dear ${options.parsedDocument.buyer.name}, you can find your ${documentTypeTitleLowercase} attached.`;
    } else {
      htmlBody = `Dear, you can find your ${documentTypeTitleLowercase} attached.`;
    }
  }

  if (options.isPlayground) {
    subject = `[PLAYGROUND/TEST] ${subject}`;
  }

  const attachments = extractDocumentAttachments(options.parsedDocument);

  if (options.xmlDocument) {
    const xmlAttachment: Attachment = {
      Content: Buffer.from(options.xmlDocument, "utf-8").toString("base64"),
      ContentID: null,
      ContentType: "application/xml",
      Name: filename + ".xml",
    };
    attachments.push(xmlAttachment);
  }

  await sendEmail({
    from: senderName
      ? `${senderName} <noreply-documents@recommand.eu>`
      : "noreply-documents@recommand.eu",
    to: options.to,
    subject: subject,
    email: htmlBody,
    attachments: attachments,
  });
}
