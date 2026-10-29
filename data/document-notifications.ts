import { companyNotificationEmailAddresses, documentNotifications, transmittedDocuments } from "@peppol/db/schema";
import { isUnreachableEmailAddressError } from "@peppol/data/email/unreachable-address";
import type { DeliveryFailure, DeliveryStatus } from "@peppol/data/deliveries/model";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { db } from "@recommand/db";
import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";

// What became of each notification email: one row per attempt, written before the
// message leaves so that the mail service's report about it always finds its row, and
// moved on by that report. Keeping these is bookkeeping: a notification is sent
// whether or not its row could be written, and a row that could not be written only
// means that attempt goes unrecorded.
//
// The mail service stops accepting mail for an address once it bounced hard or was
// complained about, until someone reactivates it there. Every later notification to
// it is refused at once. The configured address is marked unreachable when that
// happens, so the company sees it and we are alerted once rather than per email.

export type NotificationDirection = "incoming" | "outgoing";
export type DocumentNotification = typeof documentNotifications.$inferSelect;

const METADATA_NOTIFICATION_ID = "notificationId";

/** Sent with a notification email, and returned in every report about it. */
export function notificationEmailMetadata(notificationId: string): Record<string, string> {
  return { [METADATA_NOTIFICATION_ID]: notificationId };
}

/** The notification a mail service report is about, or null for any other message. */
export function notificationIdFromEmailMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const value = metadata?.[METADATA_NOTIFICATION_ID];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Why the mail service refused a notification email when it was handed over. */
export function notificationSendFailure(error: unknown): DeliveryFailure {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  const providerCode = typeof code === "number" || typeof code === "string" ? String(code) : null;
  if (!isUnreachableEmailAddressError(error)) {
    return { category: "other", message, providerCode };
  }
  // An address the service deactivated is refused (406); one it cannot parse as an
  // address is not one at all.
  return { category: providerCode === "406" ? "recipient_rejected" : "recipient_not_found", message, providerCode };
}

function logBookkeepingError(what: string, error: unknown) {
  console.error(`Could not ${what}:`, error instanceof Error ? error.message : error);
}

/** Writes the row for a notification about to be sent; null when it could not be written. */
export async function recordNotificationAttempt(attempt: {
  transmittedDocumentId: string;
  companyId: string;
  direction: NotificationDirection;
  address: string;
}): Promise<string | null> {
  try {
    const [row] = await db
      .insert(documentNotifications)
      .values({ ...attempt, address: attempt.address.toLowerCase(), status: "pending" })
      .returning({ id: documentNotifications.id });
    return row.id;
  } catch (error) {
    logBookkeepingError(`record the notification of ${attempt.transmittedDocumentId} to ${attempt.address}`, error);
    return null;
  }
}

/** Notes the message id of a notification the mail service accepted. */
export async function recordNotificationAccepted(notificationId: string | null, messageId: string | null) {
  if (!notificationId || !messageId) return;
  try {
    await db
      .update(documentNotifications)
      .set({ providerMessageId: messageId })
      .where(eq(documentNotifications.id, notificationId));
  } catch (error) {
    logBookkeepingError(`note the message of notification ${notificationId}`, error);
  }
}

/**
 * Records that the mail service refused a notification when it was handed over, and
 * marks the address unreachable when the refusal says the service will not take mail
 * for it at all.
 */
export async function recordNotificationRefused(notificationId: string | null, address: string, error: unknown) {
  const failure = notificationSendFailure(error);
  if (notificationId) {
    try {
      await db
        .update(documentNotifications)
        .set({
          status: "failed",
          statusChangedAt: new Date(),
          failureCategory: failure.category,
          failureMessage: failure.message,
          failureProviderCode: failure.providerCode,
        })
        .where(eq(documentNotifications.id, notificationId));
    } catch (bookkeepingError) {
      logBookkeepingError(`record the refusal of notification ${notificationId}`, bookkeepingError);
    }
  }
  if (isUnreachableEmailAddressError(error)) {
    await markNotificationAddressUnreachable(address, failure.message ?? "Refused by the mail service");
  }
}

/**
 * Marks every configuration of the address unreachable, and alerts once: only when
 * this call is the one that marked it. An address already marked keeps its first date
 * and reason.
 */
export async function markNotificationAddressUnreachable(address: string, reason: string, at: Date = new Date()) {
  try {
    const marked = await db
      .update(companyNotificationEmailAddresses)
      .set({ unreachableSince: at, unreachableReason: reason })
      .where(and(
        eq(companyNotificationEmailAddresses.email, address.toLowerCase()),
        isNull(companyNotificationEmailAddresses.unreachableSince)
      ))
      .returning({ companyId: companyNotificationEmailAddresses.companyId });
    if (marked.length > 0) {
      await sendSystemAlert(
        "Notification Address Unreachable",
        `The mail service no longer accepts mail for ${address}, a notification address of ${marked.length} ` +
          `${marked.length === 1 ? "company" : "companies"}: ${reason}\n\n` +
          "Every notification to it fails until the address is reactivated with the mail service. " +
          "The failed notifications are recorded and can be sent again afterwards.",
        "warning"
      );
    }
  } catch (error) {
    logBookkeepingError(`mark ${address} unreachable`, error);
  }
}

/** Clears the mark of an address that was marked before mail to it was delivered at `deliveredAt`. */
export async function clearNotificationAddressUnreachable(address: string, deliveredAt: Date) {
  await db
    .update(companyNotificationEmailAddresses)
    .set({ unreachableSince: null, unreachableReason: null })
    .where(and(
      eq(companyNotificationEmailAddresses.email, address.toLowerCase()),
      lt(companyNotificationEmailAddresses.unreachableSince, deliveredAt)
    ));
}

export type NotificationReport = {
  notificationId: string;
  status: Exclude<DeliveryStatus, "pending">;
  failure: DeliveryFailure | null;
  /** Whether the mail service deactivated the address because of this report. */
  addressDeactivated: boolean;
  /** When the delivery or bounce happened, as the mail service reports it. */
  occurredAt: Date;
};

/**
 * Applies the mail service's report about a notification email. A pending notification
 * takes either outcome; a delivered one can still fail, because a bounce can follow the
 * receiving server's acceptance; a failed one stays failed. The address is marked
 * unreachable when the report deactivated it, and cleared when mail to it was
 * delivered after it was marked.
 */
export async function applyNotificationReport(
  report: NotificationReport
): Promise<"applied" | "unchanged" | "unknown"> {
  const [notification] = await db
    .select({ address: documentNotifications.address, status: documentNotifications.status })
    .from(documentNotifications)
    .where(eq(documentNotifications.id, report.notificationId));
  if (!notification) return "unknown";

  const [moved] = await db
    .update(documentNotifications)
    .set({
      status: report.status,
      statusChangedAt: new Date(),
      failureCategory: report.failure?.category ?? null,
      failureMessage: report.failure?.message ?? null,
      failureProviderCode: report.failure?.providerCode ?? null,
    })
    .where(and(
      eq(documentNotifications.id, report.notificationId),
      report.status === "failed"
        ? inArray(documentNotifications.status, ["pending", "delivered"])
        : eq(documentNotifications.status, "pending")
    ))
    .returning({ id: documentNotifications.id });

  if (report.status === "delivered") {
    await clearNotificationAddressUnreachable(notification.address, report.occurredAt);
  } else if (report.addressDeactivated) {
    const reason = report.failure?.message ?? report.failure?.providerCode ?? "Deactivated by the mail service";
    await markNotificationAddressUnreachable(notification.address, reason, report.occurredAt);
  }
  return moved ? "applied" : "unchanged";
}

export type FailedNotification = {
  notificationId: string;
  transmittedDocumentId: string;
  teamId: string;
  companyId: string;
  direction: NotificationDirection;
  documentNumber: string | null;
  failedAt: Date;
  failureCategory: DocumentNotification["failureCategory"];
  failureMessage: string | null;
};

/**
 * The documents whose latest notification to the address failed, oldest first,
 * optionally only those whose failure falls in [since, until). A notification sent
 * again successfully is a newer row, so its document drops out of this list.
 */
export async function listFailedNotifications(options: {
  address: string;
  since?: Date;
  until?: Date;
  limit: number;
}): Promise<{ notifications: FailedNotification[]; truncated: boolean }> {
  const latest = db
    .selectDistinctOn([documentNotifications.transmittedDocumentId])
    .from(documentNotifications)
    .where(eq(documentNotifications.address, options.address.toLowerCase()))
    .orderBy(documentNotifications.transmittedDocumentId, desc(documentNotifications.createdAt), desc(documentNotifications.id))
    .as("latest");

  const rows = await db
    .select({
      notificationId: latest.id,
      transmittedDocumentId: latest.transmittedDocumentId,
      teamId: transmittedDocuments.teamId,
      companyId: latest.companyId,
      direction: latest.direction,
      documentNumber: transmittedDocuments.documentNumber,
      failedAt: latest.statusChangedAt,
      failureCategory: latest.failureCategory,
      failureMessage: latest.failureMessage,
    })
    .from(latest)
    .innerJoin(transmittedDocuments, eq(transmittedDocuments.id, latest.transmittedDocumentId))
    .where(and(
      eq(latest.status, "failed"),
      options.since ? gte(latest.statusChangedAt, options.since) : undefined,
      options.until ? lt(latest.statusChangedAt, options.until) : undefined
    ))
    .orderBy(latest.statusChangedAt, latest.transmittedDocumentId)
    .limit(options.limit + 1);

  return { notifications: rows.slice(0, options.limit), truncated: rows.length > options.limit };
}

/** Every configuration of the address, with whether it is marked unreachable. */
export async function getNotificationAddressConfigurations(address: string) {
  return await db
    .select({
      id: companyNotificationEmailAddresses.id,
      companyId: companyNotificationEmailAddresses.companyId,
      notifyIncoming: companyNotificationEmailAddresses.notifyIncoming,
      notifyOutgoing: companyNotificationEmailAddresses.notifyOutgoing,
      unreachableSince: companyNotificationEmailAddresses.unreachableSince,
      unreachableReason: companyNotificationEmailAddresses.unreachableReason,
    })
    .from(companyNotificationEmailAddresses)
    .where(eq(companyNotificationEmailAddresses.email, address.toLowerCase()));
}
