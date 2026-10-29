import { sendEmail } from "@core/lib/email";
import {
  getIncomingCompanyNotificationEmailAddresses,
  getOutgoingCompanyNotificationEmailAddresses,
} from "@peppol/data/company-notification-emails";
import DocumentIncomingNotification from "@peppol/emails/document-incoming-notification";
import DocumentOutgoingNotification from "@peppol/emails/document-outgoing-notification";
import { Attachment } from "postmark";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { isUnreachableEmailAddressError } from "@peppol/data/email/unreachable-address";
import {
  notificationEmailMetadata,
  recordNotificationAccepted,
  recordNotificationAttempt,
  recordNotificationRefused,
  type NotificationDirection,
} from "@peppol/data/document-notifications";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import type {
  AnyDocumentType,
  ParsedDocumentOf,
  StoredDocumentType,
} from "@peppol/utils/type-repository/document-types/types";
import {
  buildIncomingDocumentNotificationAttachmentParts,
  buildOutgoingDocumentNotificationAttachmentParts,
} from "@peppol/data/email/document-notification-props";
import { UNNAMED_PARTY } from "@peppol/utils/type-repository/document-types/constants";
import { getCompanyNotificationT } from "@peppol/data/notification-language";

function getDocumentUrl(transmittedDocumentId: string) {
  const baseUrl = (process.env.BASE_URL ?? "https://app.recommand.eu").replace(/\/$/, "");
  return `${baseUrl}/transmitted-documents/${transmittedDocumentId}`;
}

/** What happened to the notification for one configured address. */
export type DocumentNotificationResult =
  | { email: string; sent: true }
  | { email: string; sent: false; error: string };

export type DocumentNotificationOptions = {
  companyId: string;
  companyName: string;
  type: StoredDocumentType;
  parsedDocument: ParsedDocumentOf<AnyDocumentType> | null;
  xmlDocument: string | null;
  transmittedDocumentId: string;
  isPlayground?: boolean;
  /**
   * Notify only these of the company's configured addresses, compared without case.
   * The others are left out; an address that is not configured is not notified.
   */
  onlyEmails?: string[];
};

/** The configured addresses that a notification limited to `onlyEmails` goes to. */
export function selectNotificationAddresses<T extends { email: string }>(addresses: T[], onlyEmails?: string[]): T[] {
  if (!onlyEmails) return addresses;
  const wanted = new Set(onlyEmails.map((email) => email.trim().toLowerCase()));
  return addresses.filter((address) => wanted.has(address.email.toLowerCase()));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sends one notification email and records the attempt, its message and, when the mail
 * service refuses it, why. An address the service no longer accepts mail for is not
 * alerted per email: the address is marked unreachable instead, which alerts once.
 */
async function sendRecordedNotification(
  options: DocumentNotificationOptions,
  direction: NotificationDirection,
  address: string,
  send: (metadata: Record<string, string> | undefined) => Promise<{ messageId?: string | null }>
): Promise<DocumentNotificationResult> {
  const notificationId = await recordNotificationAttempt({
    transmittedDocumentId: options.transmittedDocumentId,
    companyId: options.companyId,
    direction,
    address,
  });
  try {
    const { messageId } = await send(notificationId ? notificationEmailMetadata(notificationId) : undefined);
    await recordNotificationAccepted(notificationId, messageId ?? null);
    return { email: address, sent: true };
  } catch (error) {
    console.error(`Failed to send ${direction} document notification to ${address}:`, error);
    await recordNotificationRefused(notificationId, address, error);
    if (!isUnreachableEmailAddressError(error)) {
      sendSystemAlert(
        "Document Notification Sending Failed",
        `Failed to send ${direction} document notification to ${address}.`,
        "error"
      );
    }
    return { email: address, sent: false, error: describeError(error) };
  }
}

/**
 * Emails the document's notification to each address the company has configured for
 * incoming documents, and reports the outcome per address. A failure for one address
 * is alerted and does not stop the others; a failure before any address is tried, such
 * as building the attachments, is thrown.
 */
export async function sendIncomingDocumentNotifications(
  options: DocumentNotificationOptions
): Promise<DocumentNotificationResult[]> {
  const notificationEmails = selectNotificationAddresses(
    await getIncomingCompanyNotificationEmailAddresses(options.companyId),
    options.onlyEmails
  );

  if (notificationEmails.length === 0) {
    return [];
  }

  const documentType = getDocumentType(options.type);
  if (documentType?.email?.areEmailNotificationsSupported === false) {
    return [];
  }
  const { documentNumber, amount, currency, senderName, receiverName } =
    documentType?.email && options.parsedDocument
      ? documentType.email.extractDocumentDetails(options.parsedDocument)
      : {};
  const t = await getCompanyNotificationT(options.companyId);
  const documentTypeLabel = documentType?.translatableTitle ?? "Document";
  const typeLabel = t(documentTypeLabel);
  let subject = documentNumber
    ? t`New ${typeLabel} received: ${documentNumber}`
    : t`New ${typeLabel} received for ${options.companyName}`;

  if (options.isPlayground) {
    subject = `[PLAYGROUND/TEST] ${subject}`;
  }

  const shouldIncludePdf = notificationEmails.some(
    (notificationEmail) => notificationEmail.includeAutoGeneratedPdfIncoming
  );
  const shouldIncludeJson = notificationEmails.some(
    (notificationEmail) => notificationEmail.includeDocumentJsonIncoming
  );
  const {
    embeddedAttachments,
    xmlAttachment,
    autoGeneratedPdfAttachment,
    documentJsonAttachment,
  } = await buildIncomingDocumentNotificationAttachmentParts({
    transmittedDocumentId: options.transmittedDocumentId,
    companyId: options.companyId,
    companyName: options.companyName,
    type: options.type,
    parsedDocument: options.parsedDocument,
    xmlDocument: options.xmlDocument,
    includeAutoGeneratedPdf: shouldIncludePdf,
    includeDocumentJson: shouldIncludeJson,
  });

  const results: DocumentNotificationResult[] = [];
  for (const notificationEmail of notificationEmails) {
    const extraAttachments: Attachment[] = [];
    if (
      notificationEmail.includeAutoGeneratedPdfIncoming &&
      autoGeneratedPdfAttachment
    ) {
      extraAttachments.push(autoGeneratedPdfAttachment);
    }
    if (
      notificationEmail.includeDocumentJsonIncoming &&
      documentJsonAttachment
    ) {
      extraAttachments.push(documentJsonAttachment);
    }

    const attachments = [
      ...embeddedAttachments,
      ...(xmlAttachment ? [xmlAttachment] : []),
      ...extraAttachments,
    ];

    results.push(
      await sendRecordedNotification(options, "incoming", notificationEmail.email, (metadata) =>
        sendEmail({
          to: notificationEmail.email,
          subject,
          email: DocumentIncomingNotification({
            t,
            companyName: options.companyName,
            senderName: senderName ?? UNNAMED_PARTY,
            documentType: documentTypeLabel,
            documentNumber: documentNumber,
            amount: amount,
            currency: currency,
            documentUrl: getDocumentUrl(options.transmittedDocumentId),
          }),
          attachments,
          metadata,
        })
      )
    );
  }
  return results;
}

/**
 * Emails the document's notification to each address the company has configured for
 * outgoing documents, and reports the outcome per address. A failure for one address
 * is alerted and does not stop the others; a failure before any address is tried, such
 * as building the attachments, is thrown.
 */
export async function sendOutgoingDocumentNotifications(
  options: DocumentNotificationOptions
): Promise<DocumentNotificationResult[]> {
  const notificationEmails = selectNotificationAddresses(
    await getOutgoingCompanyNotificationEmailAddresses(options.companyId),
    options.onlyEmails
  );

  if (notificationEmails.length === 0) {
    return [];
  }

  const documentType = getDocumentType(options.type);
  if (documentType?.email?.areEmailNotificationsSupported === false) {
    return [];
  }
  const { documentNumber, amount, currency, receiverName } =
    documentType?.email && options.parsedDocument
      ? documentType.email.extractDocumentDetails(options.parsedDocument)
      : {};
  const t = await getCompanyNotificationT(options.companyId);
  const documentTypeLabel = documentType?.translatableTitle ?? "Document";
  const typeLabel = t(documentTypeLabel);
  let subject = documentNumber
    ? t`${typeLabel} sent successfully: ${documentNumber}`
    : t`${typeLabel} sent successfully for ${options.companyName}`;

  if (options.isPlayground) {
    subject = `[PLAYGROUND/TEST] ${subject}`;
  }

  const shouldIncludePdf = notificationEmails.some(
    (notificationEmail) => notificationEmail.includeAutoGeneratedPdfOutgoing
  );
  const shouldIncludeJson = notificationEmails.some(
    (notificationEmail) => notificationEmail.includeDocumentJsonOutgoing
  );
  const {
    embeddedAttachments,
    xmlAttachment,
    autoGeneratedPdfAttachment,
    documentJsonAttachment,
  } = await buildOutgoingDocumentNotificationAttachmentParts({
    transmittedDocumentId: options.transmittedDocumentId,
    companyId: options.companyId,
    companyName: options.companyName,
    type: options.type,
    parsedDocument: options.parsedDocument,
    xmlDocument: options.xmlDocument,
    includeAutoGeneratedPdf: shouldIncludePdf,
    includeDocumentJson: shouldIncludeJson,
  });

  const results: DocumentNotificationResult[] = [];
  for (const notificationEmail of notificationEmails) {
    const extraAttachments: Attachment[] = [];
    if (
      notificationEmail.includeAutoGeneratedPdfOutgoing &&
      autoGeneratedPdfAttachment
    ) {
      extraAttachments.push(autoGeneratedPdfAttachment);
    }
    if (
      notificationEmail.includeDocumentJsonOutgoing &&
      documentJsonAttachment
    ) {
      extraAttachments.push(documentJsonAttachment);
    }

    const attachments = [
      ...embeddedAttachments,
      ...(xmlAttachment ? [xmlAttachment] : []),
      ...extraAttachments,
    ];

    results.push(
      await sendRecordedNotification(options, "outgoing", notificationEmail.email, (metadata) =>
        sendEmail({
          to: notificationEmail.email,
          subject,
          email: DocumentOutgoingNotification({
          t,
          companyName: options.companyName,
          recipientName: receiverName ?? UNNAMED_PARTY,
          documentType: documentTypeLabel,
          documentNumber: documentNumber,
          amount: amount,
          currency: currency,
          documentUrl: getDocumentUrl(options.transmittedDocumentId),
        }),
          attachments,
          metadata,
        })
      )
    );
  }
  return results;
}
