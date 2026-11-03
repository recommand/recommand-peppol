import { getCompanyById } from "@peppol/data/companies";
import { imports } from "@peppol/db/schema";
import { LEASE_MS, MAX_CONCURRENT_IMPORTS, RETRY_BACKOFF_MS } from "@peppol/utils/pipelines/intake/config";
import { createResultContext, runResult } from "@peppol/utils/pipelines/intake";
import { planImport } from "@peppol/utils/pipelines/intake/plan";
import { failure } from "@peppol/utils/pipelines/intake/types";
import { db } from "@recommand/db";
import { and, asc, eq, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { getImportFiles } from "./files";
import { finishImport, getImport, type Import, markImportProcessing } from "./imports";
import { getImportResults, publishFailedResult, ResultNotPendingError } from "./results";

const LOST_LEASE_ERROR = "The worker stopped before it finished the import";

const leaseEnd = () => sql`now() + ${`${LEASE_MS} milliseconds`}::interval`;

/**
 * Take one waiting import: queued or processing, due, not leased by another worker, of
 * a company this node is not processing already. Rows locked by another claim are
 * skipped rather than waited for. An expired lease means that the previous worker
 * stopped before it finished, for example because its process crashed: that counts as
 * a failed attempt, so an import that crashes every worker reaches the end of the retry
 * schedule too.
 */
export async function claimImport(options: { excludeCompanyIds?: string[] } = {}): Promise<Import | null> {
  return await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: imports.id })
      .from(imports)
      .where(
        and(
          inArray(imports.status, ["queued", "processing"]),
          lte(imports.nextAttemptAt, sql`now()`),
          or(isNull(imports.leaseUntil), lt(imports.leaseUntil, sql`now()`)),
          options.excludeCompanyIds?.length ? notInArray(imports.companyId, options.excludeCompanyIds) : undefined,
        ),
      )
      .orderBy(asc(imports.nextAttemptAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) {
      return null;
    }
    const [claimed] = await tx
      .update(imports)
      .set({
        leaseUntil: leaseEnd(),
        attempts: sql`case when ${imports.leaseUntil} is null then ${imports.attempts} else ${imports.attempts} + 1 end`,
        lastError: sql`case when ${imports.leaseUntil} is null then ${imports.lastError} else ${LOST_LEASE_ERROR} end`,
      })
      .where(eq(imports.id, candidate.id))
      .returning();
    return claimed;
  });
}

/** Extend the lease, only while the import is still this worker's (see `scheduleRetry`). */
async function extendLease(claimed: Import) {
  await db
    .update(imports)
    .set({ leaseUntil: leaseEnd() })
    .where(and(eq(imports.id, claimed.id), eq(imports.attempts, claimed.attempts)));
}

/**
 * After a transient failure, try again later with backoff. After the last retry, the
 * results still pending fail with `processing_unavailable`, and the import finishes.
 * A takeover always counts an attempt, so when the attempts no longer match the claim,
 * another worker owns the import and this worker leaves it alone.
 */
async function scheduleRetry(claimed: Import, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const attempts = claimed.attempts + 1;
  const retry = attempts <= RETRY_BACKOFF_MS.length;
  const [row] = await db
    .update(imports)
    .set(
      retry
        ? { attempts, lastError: message, leaseUntil: null, nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_MS[attempts - 1]) }
        : { attempts, lastError: message },
    )
    .where(and(eq(imports.id, claimed.id), eq(imports.attempts, claimed.attempts)))
    .returning();
  if (!row) {
    console.error(`Import ${claimed.id} was taken over by another worker; it is not retried by this one`);
    return;
  }
  if (!retry) {
    await giveUp(row);
  }
}

/** After the last retry: fail the results still pending with `processing_unavailable`, and finish the import. */
async function giveUp(row: Import) {
  const unavailable = failure("processing_unavailable", "The document could not be processed because a service was unavailable.");
  if (!row.planCheckpoint) {
    await finishImport(row.id, unavailable);
    return;
  }
  for (const result of await getImportResults(row.id)) {
    if (result.status === "pending") {
      await publishFailedResult(row.id, result.id, unavailable);
    }
  }
  await finishImport(row.id);
}

/** Process a claimed import as far as it goes: plan it, run its pending results, finish it. */
export async function processImport(claimed: Import): Promise<void> {
  try {
    let row = claimed.status === "queued" ? await markImportProcessing(claimed.id) : claimed;
    if (row.attempts > RETRY_BACKOFF_MS.length) {
      // The claim counted a lost lease after the last retry.
      await giveUp(row);
      return;
    }
    const company = await getCompanyById(row.companyId);
    if (!company) {
      throw new Error(`Company ${row.companyId} of import ${row.id} not found`);
    }
    if (!row.planCheckpoint) {
      const plan = await planImport(row);
      if (plan !== "planned" && plan !== "ignored") {
        await finishImport(row.id, plan);
        return;
      }
      row = (await getImport(row.id))!;
    }
    const files = await getImportFiles(row.id);
    for (const result of await getImportResults(row.id)) {
      if (result.status !== "pending") continue;
      await runResult(
        createResultContext({ importRow: row, company, result, files, onProgress: () => extendLease(claimed) }),
      );
      await extendLease(claimed);
    }
    await finishImport(row.id);
  } catch (error) {
    if (error instanceof ResultNotPendingError) {
      // Another worker took the import over after this worker's lease ran out. It owns
      // the import now, so this worker leaves the import alone.
      console.error(`Import ${claimed.id} was taken over by another worker:`, error.message);
      return;
    }
    console.error(`Import ${claimed.id} failed and will be retried:`, error);
    await scheduleRetry(claimed, error);
  }
}

// The imports this node is processing, by id, with their company.
const running = new Map<string, string>();
let workers = 0;
// The claim in progress on this node. Claims run one at a time, so each one excludes the
// companies that the claims before it took.
let claiming: Promise<unknown> = Promise.resolve();

function claimForThisNode(): Promise<Import | null> {
  const claim = claiming.then(async () => {
    const row = await claimImport({ excludeCompanyIds: [...new Set(running.values())] });
    if (row) {
      running.set(row.id, row.companyId);
    }
    return row;
  });
  claiming = claim.catch(() => {});
  return claim;
}

/** Claim and process one import. False when none is waiting. */
export async function runNextImport(): Promise<boolean> {
  const row = await claimForThisNode();
  if (!row) {
    return false;
  }
  try {
    await processImport(row);
  } finally {
    running.delete(row.id);
  }
  return true;
}

/**
 * Start processing waiting imports in the background, up to the node's limit. Called
 * after an import is accepted and every minute by the cron job, so an import a node
 * did not finish is taken over once its lease ends.
 */
export function kickImportWorker(): void {
  while (workers < MAX_CONCURRENT_IMPORTS) {
    workers++;
    void (async () => {
      try {
        while (await runNextImport()) {}
      } catch (error) {
        console.error("The import worker stopped:", error);
      } finally {
        workers--;
      }
    })();
  }
}
