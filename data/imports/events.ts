import { publishEvent } from "@core/data/rules/events";
import type { imports } from "@peppol/db/schema";
import type { db } from "@recommand/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Import = typeof imports.$inferSelect;

function importPayload(row: Import) {
  return {
    companyId: row.companyId,
    importId: row.id,
    channel: row.channel,
    status: row.status,
    revision: row.revision,
    resultCounts: { documents: row.documentCount, failed: row.failedCount },
  };
}

function eventArgs(type: string, row: Import, tx: Transaction) {
  return {
    teamId: row.teamId,
    streamId: row.companyId,
    aggregateType: "peppol.import",
    aggregateId: row.id,
    // One event of a kind per revision: the revision is what the event is about.
    idempotencyKey: `${type}:${row.id}:${row.revision}`,
    tx,
  };
}

/**
 * The import was created, started, or published a result while it was not finished. In
 * the transaction that did it.
 */
export async function publishImportChanged(row: Import, tx: Transaction) {
  await publishEvent("peppol.import.changed.v1", {
    ...eventArgs("peppol.import.changed", row, tx),
    payload: importPayload(row),
  });
}

/** The import reached its final status. The only event of that revision. */
export async function publishImportFinished(row: Import, tx: Transaction) {
  await publishEvent("peppol.import.finished.v1", {
    ...eventArgs("peppol.import.finished", row, tx),
    payload: { ...importPayload(row), failureCode: row.error?.code ?? null },
  });
}

export async function publishImportDeleted(row: Import, tx: Transaction) {
  await publishEvent("peppol.import.deleted.v1", {
    ...eventArgs("peppol.import.deleted", row, tx),
    payload: {
      companyId: row.companyId,
      importId: row.id,
      revision: row.revision,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      reason: "deleted",
    },
  });
}
