import {
  buildOutgoingTransferEvents,
  type OutgoingDocumentPayload,
} from "@peppol/data/outgoing-document-row";
import {
  newDeliveryId,
  sendDocumentEmails,
  type DocumentEmailSender,
} from "@peppol/data/email/send-document-emails";
import type { documentDeliveries, transferEvents } from "@peppol/db/schema";
import { EMAIL_DELIVERY_PROVIDER } from "./model";
import type { ParsedDocument } from "@peppol/utils/document-filename";
import type { StoredDocumentType } from "@peppol/utils/type-repository/document-types/types";

// The email a sender asked for in case the Peppol transmission fails. When the
// access point refuses the transmission in the send itself the sending pipeline
// mails it right away; when the access point accepts the transmission and reports
// the failure later, the request waits with the document and is acted on here.
// This is the one automatic action a failure triggers, it runs once, and it only
// ever goes to the addresses the sender gave. Nothing is resent over Peppol.
//
// A run can stop halfway: the process dies, or the database refuses the write that
// records what was mailed. A message the mail service accepted must then still be
// recorded and billed, and must never be mailed a second time. So the request is
// not deleted when a run takes it but marked as started, every address is noted in
// it before its message leaves, the delivery row of an accepted message is written
// on its own right away, and the bookkeeping that closes the request (billing, the
// document's email fields, the events) is one transaction that only the run which
// still finds the request open gets to commit. A later run, explicit or from the
// drain of stalled requests, picks up where the stopped one left off.

/** What a run noted about one address before mailing it. */
export type EmailFallbackAttempt = {
  /** The delivery the message is sent as; its row exists once the service accepted it. */
  deliveryId: string;
};

export type EmailFallbackRequest = {
  to: string[];
  subject?: string;
  htmlBody?: string;
  /** Set while a run holds the request; a stopped run leaves it, and a later run takes over once it is stale. */
  startedAt?: string;
  /** Per address, the delivery it is or was sent as. Noted before mailing, so no address is ever mailed twice. */
  attempts?: Record<string, EmailFallbackAttempt>;
};

/**
 * How long a run may hold the request before another run may assume it died. A
 * run mails a handful of messages and writes a few rows; minutes is generous.
 */
export const EMAIL_FALLBACK_CLAIM_STALE_MS = 15 * 60 * 1000;

/**
 * The fallback to keep with a document, or null when there is nothing to keep: the
 * email was not asked for, was asked for unconditionally and has gone out, or the
 * transmission was refused in the send and the email has gone out for that reason.
 * An address named twice is mailed once.
 */
export function emailFallbackRequest(
  email: { when: "always" | "on_peppol_failure"; to: string[]; subject?: string; htmlBody?: string } | null | undefined,
  sentPeppol: boolean
): EmailFallbackRequest | null {
  if (!email || email.when !== "on_peppol_failure" || !sentPeppol || email.to.length === 0) {
    return null;
  }
  return {
    to: [...new Set(email.to)],
    ...(email.subject !== undefined ? { subject: email.subject } : {}),
    ...(email.htmlBody !== undefined ? { htmlBody: email.htmlBody } : {}),
  };
}

/** The document a fallback is sent for, as taken together with its request. */
export type EmailFallbackDocument = {
  id: string;
  teamId: string;
  companyId: string;
  type: StoredDocumentType;
  senderId: string;
  receiverId: string | null;
  envelopeId: string | null;
  emailRecipients: string[];
  isPlayground: boolean;
  useTestNetwork: boolean;
  request: EmailFallbackRequest;
};

export type EmailFallbackDeliveryRow = typeof documentDeliveries.$inferInsert;
export type EmailFallbackTransferEventRow = typeof transferEvents.$inferInsert;

/**
 * An email delivery the fallback wrote or found: as much of it as closing the
 * request needs, and as a report that overtook it needs to find it.
 */
export type EmailFallbackDelivery = Pick<
  typeof documentDeliveries.$inferSelect,
  "id" | "address" | "status" | "failureCategory" | "failureMessage" | "provider" | "providerTransactionId"
>;

/** What the fallback needs from its surroundings; the database and the mail service in production. */
export type EmailFallbackDependencies = {
  /**
   * Takes the document's fallback request for this run, marking it started in the
   * same statement, so of two callers only one gets it. Null when the document has
   * none, another run holds it and started after `staleBefore`, or it was finished.
   */
  claim(documentId: string, options: { now: Date; staleBefore: Date }): Promise<EmailFallbackDocument | null>;
  /** Notes in the request that `address` is being mailed as `deliveryId`, before the message leaves. */
  noteAttempt(documentId: string, address: string, deliveryId: string): Promise<void>;
  /** The delivery a noted attempt produced, if its message was accepted or refused and recorded. */
  recordedDelivery(deliveryId: string): Promise<EmailFallbackDelivery | null>;
  /** The document's content as sent, with its attachments. */
  loadPayload(documentId: string): Promise<{ xml: string | null; parsed: ParsedDocument | null }>;
  /** Sends one message and returns the mail service's id for it, when it gives one. */
  sendEmail(options: {
    to: string;
    subject?: string;
    htmlBody?: string;
    xmlDocument: string | null;
    type: StoredDocumentType;
    parsedDocument: ParsedDocument | null;
    isPlayground: boolean;
    metadata: Record<string, string>;
  }): Promise<{ messageId: string | null }>;
  /** Writes one delivery row on its own, and leaves a row with that id alone if it exists. */
  recordDelivery(row: EmailFallbackDeliveryRow): Promise<EmailFallbackDelivery>;
  /**
   * Closes the request, as one transaction: the transfer events that bill the
   * messages that went out, the document's email fields, the events that announce
   * each delivery, and the request itself cleared. Returns false without writing
   * anything when the request was already closed by another run.
   */
  finish(outcome: {
    document: EmailFallbackDocument;
    deliveries: EmailFallbackDelivery[];
    transferEvents: EmailFallbackTransferEventRow[];
    sent: string[];
  }): Promise<boolean>;
  /** Gives the request up after a run failed, so a retry need not wait for the claim to go stale. */
  release(documentId: string): Promise<void>;
  audit(event: {
    documentId: string;
    teamId: string;
    sent: string[];
    failed: { address: string; message: string }[];
  }): Promise<void>;
};

export type EmailFallbackOutcome =
  /** No fallback was waiting on the document, another run holds it, or it was finished. */
  | { kind: "none" }
  | {
      kind: "sent";
      sent: string[];
      failed: { address: string; message: string }[];
      /**
       * The email deliveries this fallback stands for, as written, so reports that
       * overtook them can be applied.
       */
      deliveries: EmailFallbackDelivery[];
    };

/** The reason recorded for an address a stopped run had started on without recording the service's answer. */
export const OUTCOME_NOT_RECORDED_MESSAGE =
  "The message was handed to the mail service, but whether the service accepted it was not recorded before the run stopped.";

/**
 * Sends the email a document's sender asked for in case its Peppol transmission
 * failed, exactly as the sending pipeline would have in the send itself, and records
 * one email delivery per address: pending for an address the mail service accepted,
 * failed for one it refused. Only the emails that went out are billed. Never sends
 * twice: an address is noted in the request before it is mailed, and a run that
 * resumes a stopped one only mails addresses no run has started on. An address a
 * stopped run had started on without recording the service's answer is recorded as
 * failed rather than mailed again.
 */
export async function runEmailFallback(
  documentId: string,
  deps: EmailFallbackDependencies,
  now: Date = new Date()
): Promise<EmailFallbackOutcome> {
  const document = await deps.claim(documentId, {
    now,
    staleBefore: new Date(now.getTime() - EMAIL_FALLBACK_CLAIM_STALE_MS),
  });
  if (!document) {
    return { kind: "none" };
  }

  try {
    const payload = await deps.loadPayload(document.id);
    const send: DocumentEmailSender = ({ to, metadata }) =>
      deps.sendEmail({
        to,
        subject: document.request.subject,
        htmlBody: document.request.htmlBody,
        xmlDocument: payload.xml,
        type: document.type,
        parsedDocument: payload.parsed,
        isPlayground: document.isPlayground,
        metadata,
      });
    const base = {
      transmittedDocumentId: document.id,
      teamId: document.teamId,
      companyId: document.companyId,
      channel: "email" as const,
      statusChangedAt: now,
      useTestNetwork: document.useTestNetwork,
    };

    const deliveries: EmailFallbackDelivery[] = [];
    for (const address of document.request.to) {
      const attempt = document.request.attempts?.[address];
      if (attempt) {
        const recorded = await deps.recordedDelivery(attempt.deliveryId);
        if (recorded) {
          deliveries.push(recorded);
          continue;
        }
        // Started by a run that stopped before the service's answer was written.
        // The message may or may not have gone out; mailing it again could deliver
        // it twice, so the delivery is closed as failed with that reason.
        deliveries.push(
          await deps.recordDelivery({
            ...base,
            id: attempt.deliveryId,
            address,
            status: "failed",
            failureCategory: "other",
            failureMessage: OUTCOME_NOT_RECORDED_MESSAGE,
            provider: EMAIL_DELIVERY_PROVIDER,
          })
        );
        continue;
      }

      // Noted before the message leaves, so a run that stops between the two knows
      // that this address may already have been mailed.
      const deliveryId = newDeliveryId();
      await deps.noteAttempt(document.id, address, deliveryId);
      // Mailed through the sender both paths use, which gives the message the
      // metadata that lets the mail service's reports find this delivery.
      const attempted = await sendDocumentEmails({
        documentId: document.id,
        recipients: [address],
        deliveryId: () => deliveryId,
        send,
      });
      const accepted = attempted.sent[0];
      const row: EmailFallbackDeliveryRow = accepted
        ? {
            ...base,
            id: deliveryId,
            address,
            status: "pending",
            provider: EMAIL_DELIVERY_PROVIDER,
            providerTransactionId: accepted.providerMessageId,
          }
        : {
            ...base,
            id: deliveryId,
            address,
            status: "failed",
            failureCategory: "transport",
            failureMessage: attempted.failed[0]!.message,
            provider: EMAIL_DELIVERY_PROVIDER,
          };
      // Written right away, so a run that stops after this point has left the
      // service's answer behind for the run that resumes it.
      deliveries.push(await deps.recordDelivery(row));
    }

    const sent = deliveries
      .filter((delivery) => delivery.status === "pending")
      .map((delivery) => delivery.address);
    const failed = deliveries
      .filter((delivery) => delivery.status === "failed")
      .map((delivery) => ({ address: delivery.address, message: delivery.failureMessage ?? "" }));
    // Billed the way the sending pipeline bills an email: one event per address the
    // mail service accepted, none in a playground.
    const transferEvents = document.isPlayground
      ? []
      : buildOutgoingTransferEvents({
          teamId: document.teamId,
          companyId: document.companyId,
          transmittedDocumentId: document.id,
          document: { type: document.type, parsed: payload.parsed } as Pick<OutgoingDocumentPayload, "type" | "parsed">,
          delivery: { kind: "peppol", sentPeppol: false, emailRecipients: sent, as4Response: null },
        });

    const finished = await deps.finish({ document, deliveries, transferEvents, sent });
    if (!finished) {
      return { kind: "none" };
    }
    await deps.audit({ documentId: document.id, teamId: document.teamId, sent, failed });
    return { kind: "sent", sent, failed, deliveries };
  } catch (error) {
    // Whatever was recorded stays; the request is handed back so the next run,
    // explicit or from the drain, resumes without waiting for the claim to go stale.
    try {
      await deps.release(document.id);
    } catch (releaseError) {
      console.error("Failed to release the email fallback request:", releaseError);
    }
    throw error;
  }
}
