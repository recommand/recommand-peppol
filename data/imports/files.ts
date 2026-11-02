import { createHash } from "node:crypto";
import { deleteFile, downloadBinaryFile, uploadFile } from "@core/lib/s3";
import { companyDocumentsS3Prefix, S3_OPERATION_TIMEOUT_MS } from "@peppol/data/offload/storage";
import { files } from "@peppol/db/schema";
import type { FileFormat, FileProvenance } from "@peppol/types/intake";
import { withTimeout } from "@peppol/utils/timeout";
import { db } from "@recommand/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { monotonicFactory } from "ulid";

export type ImportFile = typeof files.$inferSelect;

// Monotonic, so the files of an import, stored in one go, list in the order they came in.
const fileUlid = monotonicFactory();
export type NewImportFile = typeof files.$inferInsert & { id: string };

/** A file to store for an import: its bytes and what it is. */
export type ImportFileUpload = {
  filename: string;
  mediaType: string;
  format: FileFormat | null;
  bytes: Uint8Array;
  provenance: FileProvenance;
};

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Store the bytes of a file an import received or derived, and return its row to
 * insert. The bytes live under the company's document prefix, so deleting the
 * company's objects removes them too.
 */
export async function uploadImportFile(
  input: ImportFileUpload & { teamId: string; companyId: string; importId: string },
): Promise<NewImportFile> {
  const id = `file_${fileUlid()}`;
  const s3Key = `${companyDocumentsS3Prefix(input.teamId, input.companyId)}imports/${input.importId}/${id}`;
  await withTimeout(uploadFile(s3Key, input.bytes, { type: input.mediaType }), S3_OPERATION_TIMEOUT_MS, `Upload of ${id}`);
  return {
    id,
    teamId: input.teamId,
    companyId: input.companyId,
    importId: input.importId,
    filename: input.filename,
    mediaType: input.mediaType,
    format: input.format,
    size: input.bytes.byteLength,
    sha256: sha256Hex(input.bytes),
    s3Key,
    provenance: input.provenance,
  };
}

/** Remove stored bytes that no row points at, after an import could not be inserted. */
export async function discardImportFiles(stored: Pick<NewImportFile, "s3Key">[]): Promise<void> {
  const removed = await Promise.allSettled(stored.map((file) => deleteFile(file.s3Key)));
  for (const outcome of removed) {
    if (outcome.status === "rejected") {
      console.error("Failed to remove the bytes of a file that was not imported:", outcome.reason);
    }
  }
}

export async function readImportFile(file: Pick<ImportFile, "s3Key">): Promise<Buffer> {
  return await downloadBinaryFile(file.s3Key, { timeoutMs: S3_OPERATION_TIMEOUT_MS });
}

export async function getImportFiles(importId: string): Promise<ImportFile[]> {
  return await db
    .select()
    .from(files)
    .where(eq(files.importId, importId))
    .orderBy(asc(files.createdAt), asc(files.id));
}

/** The files of several imports, in the order each import received them. */
export async function getFilesForImports(importIds: string[]): Promise<ImportFile[]> {
  if (importIds.length === 0) {
    return [];
  }
  return await db
    .select()
    .from(files)
    .where(inArray(files.importId, importIds))
    .orderBy(asc(files.createdAt), asc(files.id));
}

export async function getFile(id: string): Promise<ImportFile | null> {
  const [file] = await db.select().from(files).where(eq(files.id, id));
  return file ?? null;
}

/** A file an import already derived from another, so a retry does not store it twice. */
export async function findDerivedFile(importId: string, sha256: string): Promise<ImportFile | null> {
  const [file] = await db
    .select()
    .from(files)
    .where(
      and(eq(files.importId, importId), eq(files.sha256, sha256), sql`${files.provenance}->>'kind' = 'derived'`),
    )
    .orderBy(asc(files.createdAt))
    .limit(1);
  return file ?? null;
}

export async function insertImportFile(file: NewImportFile): Promise<ImportFile> {
  const [row] = await db.insert(files).values(file).returning();
  return row;
}

