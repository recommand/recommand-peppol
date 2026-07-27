import { sendEmail } from "@core/lib/email";
import { Attachment } from "postmark";
import type { DocumentType } from "@peppol/utils/document-types";
import {
  getDocumentFilename,
  type ParsedDocument,
} from "@peppol/utils/document-filename";

export function getDocumentTypeLabel(type: DocumentType): string {
  switch (type) {
    case "invoice":
      return "Invoice";
    case "creditNote":
      return "Credit Note";
    case "selfBillingInvoice":
      return "Self Billing Invoice";
    case "selfBillingCreditNote":
      return "Self Billing Credit Note";
    case "messageLevelResponse":
      return "Message Level Response";
    case "frenchInvoicingCdar":
      return "French Invoicing CDAR";
    case "frenchB2CSalesReport":
      return "French B2C Sales Report";
    case "frenchB2CPaymentReport":
      return "French B2C Payment Report";
    default:
      return "Document";
  }
}

export function extractDocumentAttachments(
  parsedDocument: ParsedDocument | null
): Attachment[] {
  const attachments: Attachment[] = [];
  if (
    parsedDocument &&
    "attachments" in parsedDocument &&
    parsedDocument.attachments
  ) {
    for (const attachment of parsedDocument.attachments) {
      if (attachment.embeddedDocument) {
        attachments.push({
          Content: attachment.embeddedDocument,
          ContentID: null,
          ContentType: attachment.mimeCode,
          Name: attachment.filename,
        });
      }
    }
  }
  return attachments;
}

export async function sendDocumentEmail(options: {
  type: DocumentType;
  parsedDocument: ParsedDocument | null;
  xmlDocument: string | null;
  to: string;
  subject?: string;
  htmlBody?: string;
  isPlayground?: boolean;
}) {
  let senderName = "";
  const filename = getDocumentFilename(options.type, options.parsedDocument);
  let subject = options.subject;
  let htmlBody = options.htmlBody;

  if (!subject) {
    const documentTypeLabel = getDocumentTypeLabel(options.type);
    if (options.parsedDocument && "invoiceNumber" in options.parsedDocument) {
      subject = `${documentTypeLabel} ${options.parsedDocument.invoiceNumber}`;
      senderName = options.parsedDocument.seller.name;
    } else if (
      options.parsedDocument &&
      "creditNoteNumber" in options.parsedDocument
    ) {
      subject = `${documentTypeLabel} ${options.parsedDocument.creditNoteNumber}`;
      senderName = options.parsedDocument.seller.name;
    } else {
      subject = documentTypeLabel;
    }
  }

  if (!htmlBody) {
    const documentTypeLabel = getDocumentTypeLabel(options.type).toLowerCase();
    if (
      options.parsedDocument &&
      "buyer" in options.parsedDocument &&
      options.parsedDocument.buyer?.name
    ) {
      htmlBody = `Dear ${options.parsedDocument.buyer.name}, you can find your ${documentTypeLabel} attached.`;
    } else {
      htmlBody = `Dear, you can find your ${documentTypeLabel} attached.`;
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
