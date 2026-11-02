import { importAttempts, importResults, imports, transmittedDocuments } from "@peppol/db/schema";
import type { Failure, Finding, SourceLocation } from "@peppol/types/intake";
import { db } from "@recommand/db";
import { and, asc, eq, gt, isNotNull, ne, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { publishImportChanged, publishImportFinished } from "./events";
import { finalStatus, updateImportRevision } from "./imports";

export type ImportResult = typeof importResults.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The result is not pending any more: another worker published or ignored it, after it
 * took over the import when this worker's lease ran out. Thrown inside the publishing
 * transaction, so the document of this worker is not recorded.
 */
export class ResultNotPendingError extends Error {
  constructor(resultId: string) {
    super(`Result ${resultId} is not pending any more`);
    this.name = "ResultNotPendingError";
  }
}

/**
 * Store what the plan step decided: the results, and the plan checkpoint that marks
 * them as created. One transaction, so a retry finds either both or neither, and the
 * result ids stay the same from then on.
 */
export async function savePlannedResults(
  importId: string,
  planned: { locations: SourceLocation[] }[],
): Promise<ImportResult[]> {
  return await db.transaction(async (tx) => {
    const rows = planned.map((result, position) => ({
      id: `res_${ulid()}`,
      importId,
      position,
      locations: result.locations,
    }));
    const inserted = rows.length > 0 ? await tx.insert(importResults).values(rows).returning() : [];
    await tx
      .update(imports)
      .set({ planCheckpoint: { resultIds: rows.map((row) => row.id) } })
      .where(eq(imports.id, importId));
    return inserted;
  });
}

export async function getImportResults(importId: string): Promise<ImportResult[]> {
  return await db
    .select()
    .from(importResults)
    .where(eq(importResults.importId, importId))
    .orderBy(asc(importResults.position));
}

/** The published results of an import in publication order, after a sequence. */
export async function listPublishedResults(
  importId: string,
  options: { afterSequence?: number; limit: number },
): Promise<ImportResult[]> {
  return await db
    .select()
    .from(importResults)
    .where(
      and(
        eq(importResults.importId, importId),
        isNotNull(importResults.sequence),
        options.afterSequence === undefined ? undefined : gt(importResults.sequence, options.afterSequence),
      ),
    )
    .orderBy(asc(importResults.sequence))
    .limit(options.limit);
}

export async function saveResultCheckpoints(
  resultId: string,
  checkpoints: Record<string, unknown>,
  locations?: SourceLocation[],
): Promise<void> {
  await db
    .update(importResults)
    .set({ checkpoints, ...(locations ? { locations } : {}) })
    .where(eq(importResults.id, resultId));
}

/**
 * Give a result its place in the publication order and count it on the import, as one
 * new import revision, in the caller's transaction. A result that is not pending any
 * more fails the transaction. When it was the last pending result, the same revision
 * finishes the import, and its event is the finished event: a terminal transition has
 * no changed event of its own.
 */
async function publishResult(
  tx: Transaction,
  importId: string,
  resultId: string,
  outcome: { documentId: string } | { error: Failure },
) {
  const [current] = await tx.select().from(imports).where(eq(imports.id, importId)).for("update");
  const [pending] = await tx
    .select({ id: importResults.id })
    .from(importResults)
    .where(and(eq(importResults.id, resultId), eq(importResults.status, "pending")))
    .for("update");
  if (!pending) {
    throw new ResultNotPendingError(resultId);
  }
  const [others] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(importResults)
    .where(and(eq(importResults.importId, importId), eq(importResults.status, "pending"), ne(importResults.id, resultId)));

  const isDocument = "documentId" in outcome;
  const counts = {
    resultSequence: current.resultSequence + 1,
    documentCount: current.documentCount + (isDocument ? 1 : 0),
    failedCount: current.failedCount + (isDocument ? 0 : 1),
  };
  const last = others.count === 0;
  const row = await updateImportRevision(tx, importId, {
    ...counts,
    ...(last ? { status: finalStatus({ ...counts, error: current.error }), finishedAt: sql`now()`, leaseUntil: null } : {}),
  });
  await tx
    .update(importResults)
    .set({
      status: isDocument ? "document" : "failed",
      documentId: isDocument ? outcome.documentId : null,
      error: isDocument ? null : outcome.error,
      sequence: row.resultSequence,
      publishedAt: sql`now()`,
    })
    .where(eq(importResults.id, resultId));
  await (last ? publishImportFinished(row, tx) : publishImportChanged(row, tx));
}

/** Publish a result that produced a document, in the transaction that recorded the document. */
export async function publishDocumentResult(
  tx: Transaction,
  importId: string,
  resultId: string,
  documentId: string,
) {
  await publishResult(tx, importId, resultId, { documentId });
}

/** Publish a result that failed. */
export async function publishFailedResult(importId: string, resultId: string, error: Failure) {
  await db.transaction((tx) => publishResult(tx, importId, resultId, { error }));
}

/** A result that turned out not to be a business document. Internal: it is never published. */
export async function ignoreResult(resultId: string, reason: string) {
  const [ignored] = await db
    .update(importResults)
    .set({ status: "ignored", error: { code: "ignored", message: reason } })
    .where(and(eq(importResults.id, resultId), eq(importResults.status, "pending")))
    .returning({ id: importResults.id });
  if (!ignored) {
    throw new ResultNotPendingError(resultId);
  }
}

/** Add findings to a document an import already published. */
export async function addDocumentFindings(documentId: string, findings: Finding[]) {
  if (findings.length === 0) return;
  await db
    .update(transmittedDocuments)
    .set({ findings: sql`coalesce(${transmittedDocuments.findings}, '[]'::jsonb) || ${JSON.stringify(findings)}::jsonb` })
    .where(eq(transmittedDocuments.id, documentId));
}

export type AttemptRecord = {
  importId: string;
  resultId: string;
  stage: string;
  model: string | null;
  startedAt: Date;
  durationMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  error?: string | null;
};

/** Execution history: one row per model call, also for a call that failed. */
export async function recordAttempt(attempt: AttemptRecord) {
  await db.insert(importAttempts).values({
    ...attempt,
    inputTokens: attempt.inputTokens ?? null,
    outputTokens: attempt.outputTokens ?? null,
    error: attempt.error ?? null,
  });
}
