import { sendEmail } from "@core/lib/email";
import { Attachment } from "postmark";
import type { StoredDocumentType } from "@peppol/utils/type-repository/document-types/types";
import {
  getDocumentFilename,
  type ParsedDocument,
} from "@peppol/utils/document-filename";
import { extractDocumentAttachments } from "@peppol/data/email/document-attachments";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { z } from "zod";

export { extractDocumentAttachments } from "@peppol/data/email/document-attachments";

export async function sendDocumentEmail(options: {
  type: StoredDocumentType;
  parsedDocument: ParsedDocument | null;
  xmlDocument: string | null;
  to: string;
  subject?: string;
  htmlBody?: string;
  replyTo?: string;
  isPlayground?: boolean;
  /** Sent with the message and returned in every report about it (see send-document-emails). */
  metadata?: Record<string, string>;
}): Promise<{ messageId: string | null }> {
  const documentType = getDocumentType(options.type);
  const documentTypeTitle = documentType?.translatableTitle ?? "Document";
  const filename = getDocumentFilename(options.type, options.parsedDocument);

  // Who a document is from and to, and what it is numbered, is the document
  // type's own business: a report carries an invoice number as well, but it
  // names the document it reports on, and self-billing reverses the two
  // parties. Only types that can be delivered by email name an email sender.
  const details =
    options.parsedDocument && documentType?.email?.isEmailDeliverySupported
      ? documentType.email.extractDocumentDetails(options.parsedDocument)
      : undefined;
  const senderName = details?.senderName ?? "";
  const replyTo = documentEmailReplyTo(options.replyTo, details?.senderEmail);

  const subject =
    options.subject ??
    (details?.documentNumber
      ? `${documentTypeTitle} ${details.documentNumber}`
      : documentTypeTitle);

  const documentTypeTitleLowercase = documentTypeTitle.toLowerCase();
  const htmlBody =
    options.htmlBody ??
    (details?.receiverName
      ? `Dear ${details.receiverName}, you can find your ${documentTypeTitleLowercase} attached.`
      : `Dear, you can find your ${documentTypeTitleLowercase} attached.`);

  const finalSubject = options.isPlayground
    ? `[PLAYGROUND/TEST] ${subject}`
    : subject;

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

  const result = await sendEmail({
    from: senderName
      ? `${senderName} <noreply-documents@recommand.eu>`
      : "noreply-documents@recommand.eu",
    to: options.to,
    subject: finalSubject,
    email: htmlBody,
    replyTo,
    attachments: attachments,
    metadata: options.metadata,
  });
  return { messageId: result.messageId ?? null };
}

/**
 * Where a reply to a document email goes: the address the sender asked for, else the
 * issuer's address from the document, so a recipient who answers the email reaches
 * the issuer rather than our sending address. An address in the document that the
 * mail service would refuse is left out instead of failing the email.
 */
export function documentEmailReplyTo(
  requested: string | undefined,
  documentSenderEmail: string | undefined
): string | undefined {
  if (requested) {
    return requested;
  }
  return documentSenderEmail && z.string().email().safeParse(documentSenderEmail).success
    ? documentSenderEmail
    : undefined;
}
