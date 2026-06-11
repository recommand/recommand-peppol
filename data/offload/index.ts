import { db } from "@recommand/db";
import { transmittedDocuments } from "@peppol/db/schema";
import { and, asc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { isS3Enabled, uploadFile } from "@core/lib/s3";
import { removeAttachmentsFromParsedDocument } from "@peppol/utils/parsing/remove-attachments";
import {
  documentAttachmentsKey,
  documentS3KeyPrefix,
  documentXmlKey,
  parsedHasAttachments,
  S3_OPERATION_TIMEOUT_MS,
} from "./storage";
import { withTimeout } from "@peppol/utils/timeout";
import type { Logger } from "@recommand/lib/logger";

const RETENTION_DAYS = 6 * 30; // TODO: Decrease to 7 days later on
// Abort a run after this many consecutive failures (e.g. S3 unavailable) so we
// don't churn through the whole table during an outage; the next run retries.
const MAX_CONSECUTIVE_FAILURES = 25;
// A claim older than this is treated as abandoned (the worker that made it
// likely crashed mid-upload) and the row becomes eligible to offload again.
// Must comfortably exceed the upload timeout so a slow-but-alive worker is not
// reclaimed out from under itself.
const CLAIM_STALE_MS = 15 * 60 * 1000;

// Prevents overlapping runs within this process: draining a large historic
// backlog can take longer than the cron interval, and the boot-time run can
// still be going when the first scheduled tick fires. Multiple *instances* may
// safely drain in parallel — they claim distinct rows via offloadClaimedAt (see
// below) — but a single process only needs one loop.
let isRunning = false;

/**
 * Offload the raw xml (and parsed.attachments) of documents older than the
 * retention window to S3, gradually slimming down the database. Documents are
 * processed strictly one at a time: each document is uploaded and then its row
 * is updated in its own statement, so an interruption at worst leaves a row to
 * be retried (the S3 keys are deterministic, making re-upload idempotent).
 */
export async function offloadOldDocuments(logger: Logger): Promise<void> {
  if (!isS3Enabled()) {
    return;
  }
  // A previous run may still be draining the backlog (which can take longer than
  // the cron interval). Skip so we never walk the table concurrently.
  if (isRunning) {
    logger.info("XML offload already running; skipping this trigger");
    return;
  }
  isRunning = true;
  try {
    await drainOldDocuments(logger);
  } finally {
    isRunning = false;
  }
}

// Drains the full backlog: every document older than the retention window has
// its xml (and attachments) offloaded, one at a time, until none remain.
async function drainOldDocuments(logger: Logger): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  let processed = 0;
  let failed = 0;
  let consecutiveFailures = 0;

  while (true) {
    // A claim made before this moment is considered abandoned, so the row is
    // eligible again. Recomputed each iteration since a full drain can run long.
    const claimStaleBefore = new Date(Date.now() - CLAIM_STALE_MS);

    // No transaction wraps the upload: the claim, upload, and finalize each grab
    // and release a connection on their own, so no DB connection (or row lock)
    // is ever held during the S3 upload. The whole operation is idempotent — the
    // S3 key is deterministic and the finalize is guarded on xmlLocation still
    // being "db" — so a crash mid-way just re-runs the row after the claim goes
    // stale.
    const [doc] = await db
      .select({
        id: transmittedDocuments.id,
        teamId: transmittedDocuments.teamId,
        companyId: transmittedDocuments.companyId,
        createdAt: transmittedDocuments.createdAt,
        xml: transmittedDocuments.xml,
        parsed: transmittedDocuments.parsed,
      })
      .from(transmittedDocuments)
      .where(
        and(
          eq(transmittedDocuments.xmlLocation, "db"),
          // Defensive: xmlLocation "db" implies xml is present, but guard
          // anyway so the loop never spins on a row it cannot offload.
          isNotNull(transmittedDocuments.xml),
          lt(transmittedDocuments.createdAt, cutoff),
          // Skip rows another worker (or a just-failed attempt) claimed recently.
          or(
            isNull(transmittedDocuments.offloadClaimedAt),
            lt(transmittedDocuments.offloadClaimedAt, claimStaleBefore)
          )
        )
      )
      .orderBy(asc(transmittedDocuments.createdAt))
      .limit(1);

    if (!doc || doc.xml == null) {
      break;
    }

    // Claim the row with a compare-and-swap update: the conditional WHERE means
    // that if another instance claimed this same row between our SELECT and now,
    // our update matches zero rows and we move on to the next one. This lets
    // multiple instances drain in parallel without holding a lock over the
    // upload, and a failed attempt leaves a fresh claim that this run skips and
    // a later run retries once it goes stale.
    const claimed = await db
      .update(transmittedDocuments)
      .set({ offloadClaimedAt: new Date() })
      .where(
        and(
          eq(transmittedDocuments.id, doc.id),
          eq(transmittedDocuments.xmlLocation, "db"),
          or(
            isNull(transmittedDocuments.offloadClaimedAt),
            lt(transmittedDocuments.offloadClaimedAt, claimStaleBefore)
          )
        )
      )
      .returning({ id: transmittedDocuments.id });

    if (claimed.length === 0) {
      continue; // another worker claimed it first
    }

    try {
      const hasAttachments = parsedHasAttachments(doc.parsed);
      const s3KeyPrefix = documentS3KeyPrefix(doc);

      // Uploads are time-bounded so a hung S3 request can't block the worker.
      await withTimeout(
        uploadFile(documentXmlKey(s3KeyPrefix), doc.xml, {
          type: "application/xml",
        }),
        S3_OPERATION_TIMEOUT_MS,
        `Offload xml upload for ${doc.id}`
      );
      if (hasAttachments) {
        await withTimeout(
          uploadFile(
            documentAttachmentsKey(s3KeyPrefix),
            JSON.stringify(
              (doc.parsed as { attachments?: unknown }).attachments
            ),
            { type: "application/json" }
          ),
          S3_OPERATION_TIMEOUT_MS,
          `Offload attachments upload for ${doc.id}`
        );
      }

      await db
        .update(transmittedDocuments)
        .set({
          xml: null,
          xmlLocation: "s3",
          parsed: removeAttachmentsFromParsedDocument(
            doc.parsed
          ) as typeof doc.parsed,
          attachmentsLocation: hasAttachments ? "s3" : "none",
          s3KeyPrefix,
        })
        // Guard on xmlLocation so a second offloader (another instance) that
        // raced on the same row simply no-ops instead of writing twice.
        .where(
          and(
            eq(transmittedDocuments.id, doc.id),
            eq(transmittedDocuments.xmlLocation, "db")
          )
        );

      processed++;
      consecutiveFailures = 0;
    } catch (error) {
      // The row keeps its fresh claim, so this run won't retry it; a later run
      // will once the claim goes stale.
      failed++;
      consecutiveFailures++;
      logger.error(
        `Failed to offload document ${doc.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Many failures in a row signal a systemic problem (e.g. S3 down or
      // hanging) rather than one bad row. Stop and let the next scheduled run
      // retry instead of churning through the entire table.
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.error(
          `Aborting XML offload run after ${consecutiveFailures} consecutive failures`
        );
        break;
      }
    }
  }

  if (processed > 0 || failed > 0) {
    logger.info(
      `XML offload run complete: ${processed} offloaded, ${failed} failed`
    );
  }
}
