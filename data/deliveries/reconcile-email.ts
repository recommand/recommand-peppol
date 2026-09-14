import { Cron } from "croner";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { ServerClient } from "postmark";
import type { Logger } from "@recommand/lib/logger";
import { db } from "@recommand/db";
import { documentDeliveries } from "@peppol/db/schema";
import {
  applyProviderDeliveryReport,
  EMAIL_DELIVERY_PROVIDER,
  interpretPostmarkBounce,
  postmarkMessageOutcomes,
  type DeliveryFailure,
  type DeliveryStatus,
  type PostmarkBounce,
  type PostmarkMessageEvent,
} from "@peppol/data/deliveries";

// Postmark reports on a message within minutes of accepting it, through its webhook.
// An email delivery still pending an hour later missed its report (the webhook was
// not yet registered, was down, or Postmark gave up retrying) and is asked about
// through the messages API, at most once an hour, in small batches. Postmark keeps
// a message's events for a limited time (45 days at most); one it no longer knows
// stays pending and is logged.
const PENDING_GRACE_MS = 60 * 60 * 1000;
const BATCH_SIZE = 50;

/** What the poll needs from Postmark; the messages and bounces API in production. */
export type PostmarkMessageSource = {
  messageEvents(messageId: string): Promise<PostmarkMessageEvent[]>;
  bounce(bounceId: number): Promise<PostmarkBounce>;
};

function postmarkMessageSource(): PostmarkMessageSource {
  const apiKey = process.env.POSTMARK_API_KEY;
  if (!apiKey) {
    throw new Error("POSTMARK_API_KEY is not set");
  }
  const client = new ServerClient(apiKey);
  return {
    async messageEvents(messageId) {
      const details = await client.getOutboundMessageDetails(messageId);
      return (details.MessageEvents ?? []) as PostmarkMessageEvent[];
    },
    async bounce(bounceId) {
      return await client.getBounce(bounceId);
    },
  };
}

/** What the poll concluded about a message, ready to be applied to its delivery. */
type MessageReport = {
  status: Exclude<DeliveryStatus, "pending">;
  failure: DeliveryFailure | null;
  payload: Record<string, unknown>;
};

/**
 * What a message's history says became of it, or null while nothing in it decides.
 * The deciding events are read latest first. A bounce is looked up for its type so
 * the failure gets the same category the webhook would have given it, and through
 * the same interpretation, so a bounce that is not a delivery outcome at all (an
 * out-of-office reply, a subscription change) decides nothing here either and does
 * not hide an earlier delivery confirmation. When the lookup fails the bounce's own
 * summary is kept as the reason.
 */
async function interpretMessageHistory(
  events: readonly PostmarkMessageEvent[],
  source: PostmarkMessageSource,
  logger: Logger,
  messageId: string
): Promise<MessageReport | null> {
  for (const outcome of postmarkMessageOutcomes(events)) {
    if (outcome.status === "delivered") {
      return { status: "delivered", failure: null, payload: { event: outcome.event } };
    }
    let bounce: PostmarkBounce | null = null;
    if (outcome.bounceId !== null) {
      try {
        bounce = await source.bounce(outcome.bounceId);
      } catch (error) {
        logger.warn(
          `Could not look up bounce ${outcome.bounceId} of message ${messageId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    if (!bounce) {
      return {
        status: "failed",
        failure: { category: "other", message: outcome.summary, providerCode: null },
        payload: { event: outcome.event },
      };
    }
    const interpretation = interpretPostmarkBounce(bounce);
    if (interpretation.kind === "informational") {
      logger.info(
        `Message ${messageId} has a bounce that says nothing about delivery (${interpretation.reason})`
      );
      continue;
    }
    return {
      status: interpretation.status,
      failure: interpretation.failure,
      payload: { event: outcome.event, bounce },
    };
  }
  return null;
}

/**
 * Asks Postmark what became of the email deliveries it never reported on, and
 * applies the answer the same way its webhook would. A delivery whose history
 * establishes nothing terminal stays pending and is asked about again.
 */
export async function reconcilePendingEmailDeliveries(
  logger: Logger,
  source: PostmarkMessageSource = postmarkMessageSource(),
  now: Date = new Date()
): Promise<{ checked: number; applied: number }> {
  const cutoff = new Date(now.getTime() - PENDING_GRACE_MS);
  const due = await db
    .select({
      id: documentDeliveries.id,
      providerTransactionId: documentDeliveries.providerTransactionId,
    })
    .from(documentDeliveries)
    .where(
      and(
        eq(documentDeliveries.channel, "email"),
        eq(documentDeliveries.status, "pending"),
        eq(documentDeliveries.provider, EMAIL_DELIVERY_PROVIDER),
        isNotNull(documentDeliveries.providerTransactionId),
        lt(documentDeliveries.statusChangedAt, cutoff),
        or(
          isNull(documentDeliveries.lastCheckedAt),
          lt(documentDeliveries.lastCheckedAt, cutoff)
        )
      )
    )
    .orderBy(
      sql`coalesce(${documentDeliveries.lastCheckedAt}, ${documentDeliveries.statusChangedAt})`
    )
    .limit(BATCH_SIZE);

  let applied = 0;
  for (const delivery of due) {
    const messageId = delivery.providerTransactionId!;
    try {
      const events = await source.messageEvents(messageId);
      const report = await interpretMessageHistory(events, source, logger, messageId);
      if (!report) {
        logger.info(
          `Delivery ${delivery.id} still pending: message ${messageId} has no delivery or bounce event that settles it`
        );
        continue;
      }
      const result = await applyProviderDeliveryReport({
        channel: "email",
        provider: EMAIL_DELIVERY_PROVIDER,
        providerTransactionId: messageId,
        deliveryId: delivery.id,
        useTestNetwork: false,
        status: report.status,
        failure: report.failure,
        eventId: null,
        eventType: null,
        payload: report.payload,
      });
      if (result === "applied") {
        applied += 1;
      }
    } catch (error) {
      logger.error(
        `Could not reconcile email delivery ${delivery.id} (message ${messageId}): ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // Noting the check is bookkeeping for the next tick; a delivery whose note
      // cannot be written is asked about again, and must not stop the rest.
      try {
        await db
          .update(documentDeliveries)
          .set({ lastCheckedAt: now })
          .where(eq(documentDeliveries.id, delivery.id));
      } catch (error) {
        logger.error(
          `Could not note the check of email delivery ${delivery.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  return { checked: due.length, applied };
}

export function initializeEmailDeliveryReconciliationCron(logger: Logger): void {
  if (process.env.RUN_CRON !== "true") {
    return;
  }

  new Cron(
    "5-59/15 * * * *",
    {
      name: "peppol.email-delivery-reconciliation",
      protect: () =>
        logger.warn("Skipping peppol.email-delivery-reconciliation tick: previous batch still running"),
    },
    async () => {
      try {
        const { checked, applied } = await reconcilePendingEmailDeliveries(logger);
        if (checked > 0) {
          logger.info(`Reconciled ${applied} of ${checked} pending email deliveries`);
        }
      } catch (error) {
        logger.error(
          `Email delivery reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  logger.info("Email delivery reconciliation cron job initialized");
}
