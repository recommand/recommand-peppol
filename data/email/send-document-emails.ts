import { ulid } from "ulid";
import { documentEmailMetadata } from "@peppol/data/deliveries/model";

// A document is mailed to each address as its own message, and each message is its
// own delivery. The delivery gets its id before the message leaves so the message
// can carry it as metadata: the mail service returns that metadata with every
// report about the message, which is how a delivery or bounce finds its delivery.
// Both the send itself and the later email fallback mail through here.

/** A message the mail service accepted, and the delivery it was sent as. */
export type SentDocumentEmail = {
  deliveryId: string;
  address: string;
  /** The mail service's id for the message; null when it did not return one. */
  providerMessageId: string | null;
};

export type FailedDocumentEmail = {
  deliveryId: string;
  address: string;
  message: string;
};

/** Sends one message and returns what the mail service said about it. */
export type DocumentEmailSender = (message: {
  to: string;
  metadata: Record<string, string>;
}) => Promise<{ messageId: string | null }>;

export function newDeliveryId(): string {
  return "dlv_" + ulid();
}

/**
 * Mails a document to each address in turn. An address the mail service refuses
 * does not stop the others; it is reported with the service's reason so the caller
 * can record a failed delivery for it.
 */
export async function sendDocumentEmails(options: {
  documentId: string;
  recipients: readonly string[];
  send: DocumentEmailSender;
  deliveryId?: () => string;
}): Promise<{ sent: SentDocumentEmail[]; failed: FailedDocumentEmail[] }> {
  const sent: SentDocumentEmail[] = [];
  const failed: FailedDocumentEmail[] = [];
  for (const address of options.recipients) {
    const deliveryId = (options.deliveryId ?? newDeliveryId)();
    try {
      const { messageId } = await options.send({
        to: address,
        metadata: documentEmailMetadata({ deliveryId, documentId: options.documentId }),
      });
      sent.push({ deliveryId, address, providerMessageId: messageId });
    } catch (error) {
      console.error("Failed to send email:", error);
      failed.push({
        deliveryId,
        address,
        message:
          error instanceof Error
            ? error.message
            : "No additional context available, please contact support@recommand.eu if you could use our help.",
      });
    }
  }
  return { sent, failed };
}
