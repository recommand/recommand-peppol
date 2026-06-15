import { db } from "@recommand/db";
import { pendingS3Deletions } from "@peppol/db/schema";
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { deleteFile, isS3Enabled, listFiles } from "@core/lib/s3";
import {
  PEPPOL_DOCUMENTS_S3_ROOT,
  S3_OPERATION_TIMEOUT_MS,
} from "@peppol/data/offload/storage";
import {
  S3_REQUEST_CONCURRENCY,
  mapWithConcurrency,
} from "@peppol/utils/concurrency";
import { withTimeout } from "@peppol/utils/timeout";
import type { Logger } from "@recommand/lib/logger";

// Abort a run after this many consecutive failures (e.g. S3 unavailable) so we
// don't churn through the whole queue during an outage; the next run retries.
const MAX_CONSECUTIVE_FAILURES = 25;
// A claim older than this is treated as abandoned (the worker that made it
// likely crashed mid-drain) and the row becomes eligible again. A live worker
// refreshes its claim after every page it deletes, so even a very large prefix
// never goes stale under an active worker.
const CLAIM_STALE_MS = 15 * 60 * 1000;
// Page size for listing objects under a prefix.
const LIST_PAGE_SIZE = 1000;

type DbOrTransaction = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Every queued prefix must point inside the offloaded-documents tree and be
// scoped to at least a team. This guards against a bug ever enqueueing a
// prefix like "" that would wipe unrelated (or all teams') objects.
function assertValidDeletionPrefix(prefix: string): void {
  const root = `${PEPPOL_DOCUMENTS_S3_ROOT}/`;
  if (!prefix.startsWith(root) || prefix.length <= root.length) {
    throw new Error(`Refusing S3 deletion of invalid prefix "${prefix}"`);
  }
}

/**
 * Queue S3 prefixes whose objects must be deleted. Call inside the same
 * transaction that deletes the corresponding database rows, so either both
 * commit or neither does — there is no window where the rows are gone but
 * nothing remembers the objects. The background worker (below) drains the
 * queue; until then the objects are unreachable, since every code path
 * resolves payloads through the (now deleted) rows.
 */
export async function enqueueS3PrefixDeletions(
  tx: DbOrTransaction,
  prefixes: string[]
): Promise<void> {
  if (prefixes.length === 0) {
    return;
  }
  for (const prefix of prefixes) {
    assertValidDeletionPrefix(prefix);
  }
  await tx
    .insert(pendingS3Deletions)
    .values(prefixes.map((prefix) => ({ prefix })));
}

// Prevents overlapping runs within this process: draining a large prefix can
// take longer than the cron interval. Multiple *instances* may safely drain in
// parallel — they claim distinct rows via claimedAt — but a single process
// only needs one loop.
let isRunning = false;

/**
 * Drain the S3 deletion queue: for each queued prefix, list and delete the
 * objects under it page by page until none remain, then remove the queue row.
 * Everything is idempotent — deleting an already-deleted object is a no-op and
 * re-listing after a crash just picks up whatever objects remain — so rows are
 * only removed once their prefix is verifiably empty.
 */
export async function processPendingS3Deletions(logger: Logger): Promise<void> {
  if (!isS3Enabled()) {
    return;
  }
  if (isRunning) {
    logger.info("S3 deletion queue already draining; skipping this trigger");
    return;
  }
  isRunning = true;
  try {
    await drainQueue(logger);
  } finally {
    isRunning = false;
  }
}

async function drainQueue(logger: Logger): Promise<void> {
  let processed = 0;
  let failed = 0;
  let consecutiveFailures = 0;

  while (true) {
    // A claim made before this moment is considered abandoned, so the row is
    // eligible again. Recomputed each iteration since a full drain can run long.
    const claimStaleBefore = new Date(Date.now() - CLAIM_STALE_MS);

    const [row] = await db
      .select()
      .from(pendingS3Deletions)
      .where(
        or(
          isNull(pendingS3Deletions.claimedAt),
          lt(pendingS3Deletions.claimedAt, claimStaleBefore)
        )
      )
      .orderBy(asc(pendingS3Deletions.createdAt))
      .limit(1);

    if (!row) {
      break;
    }

    // Claim the row with a compare-and-swap update: if another instance claimed
    // it between our SELECT and now, the update matches zero rows and we move
    // on. No lock is held while the prefix drains; a failed attempt leaves a
    // fresh claim that this run skips and a later run retries once it goes stale.
    const claimed = await db
      .update(pendingS3Deletions)
      .set({ claimedAt: new Date() })
      .where(
        and(
          eq(pendingS3Deletions.id, row.id),
          or(
            isNull(pendingS3Deletions.claimedAt),
            lt(pendingS3Deletions.claimedAt, claimStaleBefore)
          )
        )
      )
      .returning({ id: pendingS3Deletions.id });

    if (claimed.length === 0) {
      continue; // another worker claimed it first
    }

    try {
      const deletedCount = await deleteObjectsUnderPrefix(row);
      await db
        .delete(pendingS3Deletions)
        .where(eq(pendingS3Deletions.id, row.id));
      logger.info(
        `Deleted ${deletedCount} S3 objects under prefix ${row.prefix}`
      );
      processed++;
      consecutiveFailures = 0;
    } catch (error) {
      // The row keeps its fresh claim, so this run won't retry it; a later run
      // will once the claim goes stale.
      failed++;
      consecutiveFailures++;
      logger.error(
        `Failed to delete S3 objects under prefix ${row.prefix}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Many failures in a row signal a systemic problem (e.g. S3 down or
      // hanging) rather than one bad row. Stop and let the next scheduled run
      // retry instead of churning through the entire queue.
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.error(
          `Aborting S3 deletion run after ${consecutiveFailures} consecutive failures`
        );
        break;
      }
    }
  }

  if (processed > 0 || failed > 0) {
    logger.info(
      `S3 deletion run complete: ${processed} prefixes drained, ${failed} failed`
    );
  }
}

// Delete every object under the prefix, repeatedly fetching the first page of
// the listing and deleting it until the listing comes back empty. Deleting as
// we go (rather than paginating with continuation tokens) keeps this trivially
// crash-safe: a restarted run simply lists whatever objects remain. Any
// failure throws, so the queue row is kept and the whole prefix retried later.
async function deleteObjectsUnderPrefix(row: {
  id: string;
  prefix: string;
}): Promise<number> {
  assertValidDeletionPrefix(row.prefix);

  let deletedCount = 0;
  while (true) {
    const page = await withTimeout(
      listFiles(row.prefix, { maxKeys: LIST_PAGE_SIZE }),
      S3_OPERATION_TIMEOUT_MS,
      `List S3 objects under ${row.prefix}`
    );
    const keys = (page.contents ?? [])
      .map((object) => object.key)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) {
      return deletedCount;
    }

    await mapWithConcurrency(keys, S3_REQUEST_CONCURRENCY, (key) =>
      withTimeout(
        deleteFile(key),
        S3_OPERATION_TIMEOUT_MS,
        `Delete S3 object ${key}`
      )
    );
    deletedCount += keys.length;

    // Refresh the claim so a long drain (a prefix with hundreds of thousands
    // of objects spans many pages) is not reclaimed by another instance.
    await db
      .update(pendingS3Deletions)
      .set({ claimedAt: new Date() })
      .where(eq(pendingS3Deletions.id, row.id));
  }
}
