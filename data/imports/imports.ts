import { files, imports } from "@peppol/db/schema";
import {
  FINAL_IMPORT_STATUSES,
  type Failure,
  type ImportStatus,
} from "@peppol/types/intake";
import { db } from "@recommand/db";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { publishImportChanged, publishImportDeleted, publishImportFinished } from "./events";
import { discardImportFiles, type ImportFile, type ImportFileUpload, type NewImportFile, uploadImportFile } from "./files";

export type Import = typeof imports.$inferSelect;
export type NewImport = typeof imports.$inferInsert & { id: string };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The import is still queued or processing, so it cannot be deleted yet. */
export class ImportInProgressError extends Error {
  constructor() {
    super("The import is still being processed");
    this.name = "ImportInProgressError";
  }
}

export function isFinalImportStatus(status: ImportStatus): boolean {
  return FINAL_IMPORT_STATUSES.includes(status);
}

/**
 * Accept an import: store the bytes of its files, then insert the import, its files and
 * its first changed event in one transaction. `toResponse` gives the body of the
 * accepting response, which is stored with the import for an idempotent replay. When the
 * insert fails, for example on a unique violation because the idempotency key or the
 * email receipt is already taken, the stored bytes are removed again: no row points at
 * them.
 */
export async function acceptImport(
  values: NewImport,
  uploads: ImportFileUpload[],
  toResponse?: (row: Import, files: ImportFile[]) => Record<string, unknown>,
): Promise<Import> {
  const stored: NewImportFile[] = [];
  try {
    for (const upload of uploads) {
      stored.push(
        await uploadImportFile({ ...upload, teamId: values.teamId, companyId: values.companyId, importId: values.id }),
      );
    }
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(imports).values(values).returning();
      const inserted = stored.length > 0 ? await tx.insert(files).values(stored).returning() : [];
      await publishImportChanged(row, tx);
      if (!toResponse) {
        return row;
      }
      const [withResponse] = await tx
        .update(imports)
        .set({ idempotencyResponse: toResponse(row, inserted) })
        .where(eq(imports.id, row.id))
        .returning();
      return withResponse;
    });
  } catch (error) {
    await discardImportFiles(stored);
    throw error;
  }
}

/** An import by id, deleted or not. */
export async function getImport(id: string): Promise<Import | null> {
  const [row] = await db.select().from(imports).where(eq(imports.id, id));
  return row ?? null;
}

export async function findImportByIdempotencyKey(companyId: string, key: string): Promise<Import | null> {
  const [row] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.companyId, companyId), eq(imports.idempotencyKey, key)));
  return row ?? null;
}

export async function findEmailImport(inboundAddressId: string, providerMessageId: string): Promise<Import | null> {
  const [row] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.inboundAddressId, inboundAddressId), eq(imports.providerMessageId, providerMessageId)));
  return row ?? null;
}

/**
 * A team's imports that are not deleted, newest first, after an import in that order; only
 * those of the given companies when there are any. The ids are ULIDs, so their order is the
 * creation order; unlike `createdAt`, which has microseconds in the database, an id is exact
 * in a cursor.
 */
export async function listImports(options: {
  teamId: string;
  companyIds?: string[];
  statuses?: ImportStatus[];
  createdFrom?: Date;
  createdBefore?: Date;
  afterId?: string;
  limit: number;
}): Promise<Import[]> {
  return await db
    .select()
    .from(imports)
    .where(
      and(
        eq(imports.teamId, options.teamId),
        options.companyIds?.length ? inArray(imports.companyId, options.companyIds) : undefined,
        isNull(imports.deletedAt),
        options.statuses?.length ? inArray(imports.status, options.statuses) : undefined,
        options.createdFrom ? gte(imports.createdAt, options.createdFrom) : undefined,
        options.createdBefore ? lt(imports.createdAt, options.createdBefore) : undefined,
        options.afterId ? lt(imports.id, options.afterId) : undefined,
      ),
    )
    .orderBy(desc(imports.id))
    .limit(options.limit);
}

/**
 * Change an import as one new revision, in the caller's transaction. Every committed
 * change of an import goes through here, so its revision counts them.
 */
export async function updateImportRevision(
  tx: Transaction,
  id: string,
  changes: { [K in keyof Import]?: Import[K] | SQL },
): Promise<Import> {
  const [row] = await tx
    .update(imports)
    .set({ ...changes, revision: sql`${imports.revision} + 1`, updatedAt: sql`now()` } as unknown as typeof imports.$inferInsert)
    .where(eq(imports.id, id))
    .returning();
  return row;
}

/** A logical deletion: the import leaves the API, its documents and files stay. */
export async function deleteImport(row: Import): Promise<void> {
  if (row.deletedAt) {
    return;
  }
  if (!isFinalImportStatus(row.status)) {
    throw new ImportInProgressError();
  }
  await db.transaction(async (tx) => {
    const deleted = await updateImportRevision(tx, row.id, { deletedAt: sql`now()` });
    await publishImportDeleted(deleted, tx);
  });
}

/** Processing started for a queued import. */
export async function markImportProcessing(id: string): Promise<Import> {
  return await db.transaction(async (tx) => {
    const row = await updateImportRevision(tx, id, { status: "processing" });
    await publishImportChanged(row, tx);
    return row;
  });
}

/** The status of an import without pending results: it follows from what was published. */
export function finalStatus(row: Pick<Import, "documentCount" | "failedCount" | "error">): ImportStatus {
  if (row.error) return "failed";
  if (row.documentCount > 0 && row.failedCount > 0) return "partially_completed";
  if (row.documentCount > 0) return "completed";
  if (row.failedCount > 0) return "failed";
  return "ignored";
}

/**
 * Finish an import that has no pending result left, when publishing its last result did
 * not already: its results were all ignored, or the whole input failed with `error`.
 * Published once.
 */
export async function finishImport(id: string, error?: Failure): Promise<Import> {
  return await db.transaction(async (tx) => {
    const [current] = await tx.select().from(imports).where(eq(imports.id, id)).for("update");
    if (isFinalImportStatus(current.status)) {
      return current;
    }
    const status = finalStatus({ ...current, error: error ?? current.error });
    const row = await updateImportRevision(tx, id, {
      status,
      error: error ?? current.error,
      finishedAt: sql`now()`,
      leaseUntil: null,
      ...(error ? { planCheckpoint: current.planCheckpoint ?? { resultIds: [] } } : {}),
    });
    await publishImportFinished(row, tx);
    return row;
  });
}

/**
 * Support recovery: try a waiting import again now, with the full retry schedule. Only an
 * import that is not finished and that no worker holds: a finished import and its
 * published results are final, and a worker that holds the import keeps its own retry
 * bookkeeping. It changes the worker state only, so it makes no revision and no event.
 * Returns whether the import was waiting.
 */
export async function restartImportRetries(id: string): Promise<boolean> {
  const restarted = await db
    .update(imports)
    .set({ attempts: 0, nextAttemptAt: sql`now()`, lastError: null })
    .where(
      and(
        eq(imports.id, id),
        inArray(imports.status, ["queued", "processing"]),
        or(isNull(imports.leaseUntil), lt(imports.leaseUntil, sql`now()`)),
      ),
    )
    .returning({ id: imports.id });
  return restarted.length > 0;
}
