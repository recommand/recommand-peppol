import { Cron } from "croner";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Logger } from "@recommand/lib/logger";
import { db } from "@recommand/db";
import { documentDeliveries, teamExtensions, transmittedDocuments } from "@peppol/db/schema";
import type { AccessPointProviderId } from "@peppol/data/peppol-providers";
import { buildOutgoingDocumentDeliveries } from "@peppol/data/outgoing-document-row";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";

// Deliveries for the outgoing documents that predate delivery tracking. They are
// derived from what each document recorded about its transmission, in bounded
// batches that each commit on their own, so the documents table is never locked
// for longer than one batch and a deploy does not wait for history. The job keeps
// going until no outgoing document is left without deliveries, then does nothing.
// Documents recorded since the deploy get their deliveries with the document, so
// only documents that have none are ever touched.

/** What a document recorded about its transmission, as much of it as its deliveries need. */
export type HistoricalOutgoingDocument = {
  id: string;
  teamId: string;
  companyId: string;
  receiverId: string | null;
  sentOverPeppol: boolean;
  emailRecipients: string[];
  accessPointProvider: AccessPointProviderId;
  apTransactionId: string | null;
  useTestNetwork: boolean;
  createdAt: Date;
};

/**
 * The delivery rows of a document recorded before delivery tracking, built by the
 * same rules as a document recorded today: a transmission through our own access
 * point or a simulated one was acknowledged in the send and is delivered; one
 * through an access point that reports later, recognisable by its transaction id,
 * is pending until the reconciliation poll settles it; a document with a receiver
 * that never went over Peppol was refused in the send and is failed; each mailed
 * address is a delivered email delivery. Everything is dated when the document was.
 */
export function buildHistoricalDeliveries(
  document: HistoricalOutgoingDocument
): (typeof documentDeliveries.$inferInsert)[] {
  return buildOutgoingDocumentDeliveries({
    transmittedDocumentId: document.id,
    teamId: document.teamId,
    company: { id: document.companyId, accessPointProvider: document.accessPointProvider },
    document: { receiverId: document.receiverId },
    delivery: {
      kind: "peppol",
      sentPeppol: document.sentOverPeppol,
      emailRecipients: document.emailRecipients,
      as4Response: document.apTransactionId
        ? {
            ok: true,
            peppolMessageId: null,
            peppolConversationId: null,
            receivedPeppolSignalMessage: null,
            sbdhInstanceIdentifier: null,
            apTransactionId: document.apTransactionId,
          }
        : null,
      peppolFailure: document.sentOverPeppol
        ? null
        : { category: "other", message: null, providerCode: null },
    },
    useTestNetwork: document.useTestNetwork,
    now: document.createdAt,
  }).map((row) => ({
    ...row,
    createdAt: document.createdAt,
    // These messages left before a document email carried a reference, so no mail
    // service report can ever be matched to them and pending would never resolve.
    // They were accepted by the mail service at the time, which is what
    // sentOverEmail already claims, so that is what they are recorded as.
    ...(row.channel === "email" ? { status: "delivered" as const } : {}),
  }));
}

export type BackfillBatchResult = {
  documents: number;
  deliveries: number;
  /** The last document id of the batch, to continue after; null when nothing was left. */
  lastId: string | null;
};

/** Where the batches come from and go to; the database in production, a fake in tests. */
export type BackfillStore = {
  /**
   * Takes the next documents after `afterId`, in id order, that have no deliveries
   * yet, writes their deliveries, and commits. Runs each batch as one transaction.
   * Documents another transaction holds locked are left out, not waited for.
   */
  processBatch(afterId: string, limit: number): Promise<BackfillBatchResult>;
  /**
   * Whether any document without deliveries is left, counting the ones a batch
   * would have left out because they were locked. A plain read, which waits for
   * nobody.
   */
  hasRemaining(): Promise<boolean>;
};

export type BackfillState = {
  /** The document id the next batch continues after; empty at the start of a pass. */
  cursor: string;
  /** How many deliveries the current pass has written so far. */
  writtenThisPass: number;
  /** Set once a full pass over the documents wrote nothing: there is nothing left. */
  finished: boolean;
};

export function initialBackfillState(): BackfillState {
  return { cursor: "", writtenThisPass: 0, finished: false };
}

const DEFAULT_BATCH_SIZE = 500;

/**
 * Works through the documents without deliveries until none are left or the deadline
 * passes, keeping its place in `state` so the next run continues where this one
 * stopped. A pass walks the documents in id order; reaching the end starts a new
 * pass, so a batch that rolled back or a document another worker was holding is
 * picked up. A pass that writes nothing is the last one, provided a read that skips
 * no locked row agrees nothing is left; otherwise a document was locked throughout
 * the pass, and the job stops for this run and walks again next time.
 */
export async function runDeliveryBackfill(
  store: BackfillStore,
  state: BackfillState,
  options: { batchSize?: number; deadline?: Date; now?: () => Date } = {}
): Promise<{ documents: number; deliveries: number; finished: boolean }> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const now = options.now ?? (() => new Date());
  let documents = 0;
  let deliveries = 0;

  while (!state.finished && (!options.deadline || now() < options.deadline)) {
    const batch = await store.processBatch(state.cursor, batchSize);
    if (batch.lastId === null) {
      // End of a pass. A pass that found nothing to write means every outgoing
      // document has its deliveries, unless a locked one was skipped all along;
      // otherwise walk once more from the start.
      const nothingWritten = state.writtenThisPass === 0;
      state.cursor = "";
      state.writtenThisPass = 0;
      if (!nothingWritten) {
        continue;
      }
      if (await store.hasRemaining()) {
        break;
      }
      state.finished = true;
      continue;
    }
    state.cursor = batch.lastId;
    state.writtenThisPass += batch.deliveries;
    documents += batch.documents;
    deliveries += batch.deliveries;
  }
  return { documents, deliveries, finished: state.finished };
}

const hasNoDeliveries = sql`not exists (select 1 from ${documentDeliveries} where ${documentDeliveries.transmittedDocumentId} = ${transmittedDocuments.id})`;

/**
 * The database as a backfill store. The documents of a batch are locked while their
 * deliveries are written and skipped by any other worker on the same batch, so two
 * instances running the job never write the same document twice.
 */
export const databaseBackfillStore: BackfillStore = {
  async processBatch(afterId, limit) {
    return await db.transaction(async (tx) => {
      const documents = await tx
        .select({
          id: transmittedDocuments.id,
          teamId: transmittedDocuments.teamId,
          companyId: transmittedDocuments.companyId,
          receiverId: transmittedDocuments.receiverId,
          sentOverPeppol: transmittedDocuments.sentOverPeppol,
          emailRecipients: transmittedDocuments.emailRecipients,
          accessPointProvider: transmittedDocuments.accessPointProvider,
          apTransactionId: transmittedDocuments.apTransactionId,
          useTestNetwork: sql<boolean>`coalesce(${teamExtensions.useTestNetwork}, false)`,
          createdAt: transmittedDocuments.createdAt,
        })
        .from(transmittedDocuments)
        .leftJoin(teamExtensions, eq(teamExtensions.id, transmittedDocuments.teamId))
        .where(
          and(
            eq(transmittedDocuments.direction, "outgoing"),
            isNull(transmittedDocuments.externalReferenceId),
            gt(transmittedDocuments.id, afterId),
            hasNoDeliveries
          )
        )
        .orderBy(asc(transmittedDocuments.id))
        .limit(limit)
        .for("update", { of: transmittedDocuments, skipLocked: true });
      if (documents.length === 0) {
        return { documents: 0, deliveries: 0, lastId: null };
      }
      const rows = documents.flatMap((document) =>
        buildHistoricalDeliveries({ ...document, emailRecipients: document.emailRecipients ?? [] })
      );
      if (rows.length > 0) {
        await tx.insert(documentDeliveries).values(rows);
      }
      return { documents: documents.length, deliveries: rows.length, lastId: documents.at(-1)!.id };
    });
  },

  async hasRemaining() {
    const [row] = await db
      .select({ id: transmittedDocuments.id })
      .from(transmittedDocuments)
      .where(
        and(
          eq(transmittedDocuments.direction, "outgoing"),
          isNull(transmittedDocuments.externalReferenceId),
          hasNoDeliveries
        )
      )
      .limit(1);
    return row !== undefined;
  },
};

// Each tick works for most of a minute and hands over to the next; the cron's guard
// keeps a slow tick from overlapping with the next one in the same process.
const TICK_BUDGET_MS = 45 * 1000;

const state = initialBackfillState();

export function initializeDeliveryBackfillCron(logger: Logger): void {
  if (process.env.RUN_CRON !== "true") {
    return;
  }

  new Cron(
    "* * * * *",
    {
      name: "peppol.delivery-backfill",
      protect: () => logger.warn("Skipping peppol.delivery-backfill tick: previous batch still running"),
    },
    async () => {
      if (state.finished) {
        return;
      }
      try {
        const progress = await runDeliveryBackfill(databaseBackfillStore, state, {
          deadline: new Date(Date.now() + TICK_BUDGET_MS),
        });
        if (progress.documents > 0) {
          logger.info(
            `Backfilled ${progress.deliveries} deliveries for ${progress.documents} documents`
          );
        }
        if (progress.finished) {
          logger.info("Delivery backfill complete: every outgoing document has its deliveries");
          sendSystemAlert(
            "Delivery Backfill Complete",
            "Every outgoing document recorded before delivery tracking now has its deliveries. The job has nothing left to do.",
            "info"
          );
        }
      } catch (error) {
        logger.error(
          `Delivery backfill failed, continuing next tick: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  logger.info("Delivery backfill cron job initialized");
}
