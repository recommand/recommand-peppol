import { Cron } from "croner";
import { and, eq, inArray, isNotNull, lt, or, isNull, sql } from "drizzle-orm";
import type { Logger } from "@recommand/lib/logger";
import { db } from "@recommand/db";
import { documentDeliveries } from "@peppol/db/schema";
import { fetchArratechJson, getArratechConfig } from "@peppol/data/at/client";
import {
  applyProviderDeliveryReport,
  interpretArratechTransactionStatus,
  pruneStagedDeliveryReports,
  drainStagedDeliveryReports,
  type ArratechServiceError,
} from "@peppol/data/deliveries";
import { resumeStalledEmailFallbacks } from "@peppol/data/deliveries/email-fallback-db";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";

// The access point that reports delivery outcomes after accepting a send, and so the
// only one whose deliveries can be left pending by a report that never arrived.
const ARRATECH_ACCESS_POINT_PROVIDER = "at-shared-ap-fr";

// A report normally follows the send within minutes. A delivery still pending an hour
// later is one whose report was missed, and is asked about at most once an hour so
// a transaction the provider cannot answer for does not get asked about every tick.
const PENDING_GRACE_MS = 60 * 60 * 1000;
const BATCH_SIZE = 100;
// A transaction the provider has not settled three days after accepting it is not
// going to settle on its own: it is stuck in one of the provider's intermediate
// states, and asking every hour only repeats the same answer. Such a delivery stays
// pending, is reported once so someone can take it up with the provider, and is not
// asked about again.
const MAX_PENDING_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// The deliveries are asked about one after the other, so a provider that keeps a
// request open would hold up the whole batch and every tick after it. Each request
// gets this long, response body included.
const REQUEST_TIMEOUT_MS = 15 * 1000;

type ArratechTransaction = {
  transactionStatus?: string | null;
  serviceError?: ArratechServiceError | null;
};

/**
 * Asks the access point what became of the deliveries it never reported on, and
 * applies the answer the same way its webhook would. This is also what settles the
 * deliveries created for documents that predate delivery tracking.
 */
export async function reconcilePendingArratechDeliveries(
  logger: Logger,
  now: Date = new Date(),
  options: { requestTimeoutMs?: number } = {}
): Promise<{ checked: number; applied: number }> {
  const cutoff = new Date(now.getTime() - PENDING_GRACE_MS);
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const due = await db
    .select({
      id: documentDeliveries.id,
      providerTransactionId: documentDeliveries.providerTransactionId,
      useTestNetwork: documentDeliveries.useTestNetwork,
    })
    .from(documentDeliveries)
    .where(
      and(
        eq(documentDeliveries.channel, "peppol"),
        eq(documentDeliveries.status, "pending"),
        eq(documentDeliveries.provider, ARRATECH_ACCESS_POINT_PROVIDER),
        isNotNull(documentDeliveries.providerTransactionId),
        isNull(documentDeliveries.reconciliationEndedAt),
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
    const transactionId = delivery.providerTransactionId!;
    try {
      const config = getArratechConfig(delivery.useTestNetwork);
      const transaction = await fetchArratechJson<ArratechTransaction>(
        `/orgs/${config.orgId}/transactions/${encodeURIComponent(transactionId)}`,
        {
          method: "GET",
          useTestNetwork: delivery.useTestNetwork,
          signal: AbortSignal.timeout(requestTimeoutMs),
        }
      );
      const outcome = interpretArratechTransactionStatus(transaction);
      if (!outcome) {
        logger.info(
          `Delivery ${delivery.id} still pending: transaction ${transactionId} is ${transaction.transactionStatus ?? "without status"}`
        );
        continue;
      }
      const result = await applyProviderDeliveryReport({
        channel: "peppol",
        provider: ARRATECH_ACCESS_POINT_PROVIDER,
        providerTransactionId: transactionId,
        useTestNetwork: delivery.useTestNetwork,
        status: outcome.status,
        failure: outcome.failure,
        eventId: null,
        eventType: null,
        payload: transaction as Record<string, unknown>,
      });
      if (result === "applied") {
        applied += 1;
      }
    } catch (error) {
      logger.error(
        `Could not reconcile delivery ${delivery.id} (transaction ${transactionId}): ${error instanceof Error ? error.message : String(error)}`
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
          `Could not note the check of delivery ${delivery.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  return { checked: due.length, applied };
}

/**
 * Stops asking about the deliveries that have been pending longer than the provider
 * could plausibly need, and reports them once. They keep their status: nothing is
 * known about them, and saying otherwise would be a guess. Returns how many were
 * given up on this time.
 */
export async function stopReconcilingExpiredDeliveries(
  logger: Logger,
  now: Date = new Date()
): Promise<number> {
  const expiredBefore = new Date(now.getTime() - MAX_PENDING_AGE_MS);
  const expired = await db
    .select({
      id: documentDeliveries.id,
      providerTransactionId: documentDeliveries.providerTransactionId,
    })
    .from(documentDeliveries)
    .where(
      and(
        eq(documentDeliveries.channel, "peppol"),
        eq(documentDeliveries.status, "pending"),
        eq(documentDeliveries.provider, ARRATECH_ACCESS_POINT_PROVIDER),
        isNotNull(documentDeliveries.providerTransactionId),
        isNull(documentDeliveries.reconciliationEndedAt),
        lt(documentDeliveries.statusChangedAt, expiredBefore)
      )
    )
    .limit(BATCH_SIZE);
  if (expired.length === 0) {
    return 0;
  }

  await db
    .update(documentDeliveries)
    .set({ reconciliationEndedAt: now })
    .where(
      inArray(
        documentDeliveries.id,
        expired.map((delivery) => delivery.id)
      )
    );

  const summary = expired
    .map((delivery) => `${delivery.id} (transaction ${delivery.providerTransactionId})`)
    .join("\n");
  logger.warn(
    `Stopped asking about ${expired.length} deliveries pending for over ${MAX_PENDING_AGE_MS / 86_400_000} days:\n${summary}`
  );
  sendSystemAlert(
    "Delivery Reconciliation Stopped",
    `${expired.length} Peppol deliveries have been pending for more than ${MAX_PENDING_AGE_MS / 86_400_000} days without the access point settling them. ` +
      `They stay pending and are no longer asked about; take them up with the provider.\n${summary}`,
    "warning"
  );
  return expired.length;
}

/**
 * One tick of the reconciliation: ask the access point about the deliveries it never
 * reported on, give up on the ones it never will, drop the reports that never found
 * a document, and finish the email fallbacks a stopped run left half done. The steps
 * are independent, so a tick does all of them; only an error thrown out of one stops
 * the rest, and the next tick starts over.
 */
export async function runDeliveryReconciliationTick(logger: Logger): Promise<void> {
  try {
    const applied = await drainStagedDeliveryReports(logger);
    if (applied > 0) {
      logger.info(`Replayed ${applied} stored delivery reports`);
    }
  } catch (error) {
    logger.error(
      `Could not replay stored delivery reports: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  try {
    const { checked, applied } = await reconcilePendingArratechDeliveries(logger);
    if (checked > 0) {
      logger.info(`Reconciled ${applied} of ${checked} pending deliveries`);
    }
  } catch (error) {
    logger.error(
      `Delivery reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  try {
    await stopReconcilingExpiredDeliveries(logger);
  } catch (error) {
    logger.error(
      `Could not give up on expired deliveries: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  try {
    const pruned = await pruneStagedDeliveryReports();
    if (pruned > 0) {
      logger.info(`Dropped ${pruned} delivery reports that never found a document`);
    }
    const stalled = await resumeStalledEmailFallbacks();
    if (stalled.found > 0) {
      logger.info(`Resumed ${stalled.resumed} of ${stalled.found} stalled email fallbacks`);
    }
  } catch (error) {
    logger.error(
      `Delivery reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function initializeDeliveryReconciliationCron(logger: Logger): void {
  if (process.env.RUN_CRON !== "true") {
    return;
  }

  new Cron(
    "*/10 * * * *",
    {
      name: "peppol.delivery-reconciliation",
      protect: () =>
        logger.warn("Skipping peppol.delivery-reconciliation tick: previous batch still running"),
    },
    async () => await runDeliveryReconciliationTick(logger)
  );

  logger.info("Delivery reconciliation cron job initialized");
}
