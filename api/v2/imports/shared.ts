import type { Context } from "hono";
import type { z } from "zod";
import type { ImportFile } from "@peppol/data/imports/files";
import { getImport, type Import } from "@peppol/data/imports/imports";
import type { ImportResult } from "@peppol/data/imports/results";
import type { fileReferenceSchema, fileSchema, importResultSchema, importSchema } from "@peppol/api/v2/schemas";
import {
  ApiProblem,
  authorizeCompany,
  deletedProblem,
  IDEMPOTENCY_EXPIRES_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
} from "@peppol/api/v2/shared";

export const TAGS = ["Imports"];

export function toFileReference(file: ImportFile): z.infer<typeof fileReferenceSchema> {
  return { id: file.id, filename: file.filename, mediaType: file.mediaType, size: file.size };
}

export function toFile(file: ImportFile): z.infer<typeof fileSchema> {
  return {
    id: file.id,
    companyId: file.companyId,
    filename: file.filename,
    mediaType: file.mediaType,
    size: file.size,
    sha256: file.sha256,
    format: file.format ?? null,
    profileId: null,
    provenance: file.provenance,
    createdAt: file.createdAt.toISOString(),
    retainUntil: null,
  };
}

export function toImport(row: Import, files: ImportFile[]): z.infer<typeof importSchema> {
  const recordedAt = row.createdAt.toISOString();
  return {
    id: row.id,
    revision: row.revision,
    companyId: row.companyId,
    status: row.status,
    createdAt: recordedAt,
    updatedAt: row.updatedAt.toISOString(),
    source: { ...row.source, recordedAt },
    files: files.map(toFileReference),
    resultCounts: { documents: row.documentCount, failed: row.failedCount },
    error: row.error ?? null,
  };
}

export function toImportResult(result: ImportResult): z.infer<typeof importResultSchema> {
  return {
    id: result.id,
    locations: result.locations,
    documentId: result.documentId,
    error: result.error ?? null,
  };
}

/** An import the caller may access with the permission; a deleted one is gone. */
export async function loadImport(c: Context, id: string, permissionId: string): Promise<Import> {
  const row = await getImport(id);
  if (!row) {
    throw new ApiProblem(404, "not_found", "The import does not exist or is not accessible.");
  }
  await authorizeCompany(c, row.companyId, permissionId, "import");
  if (row.deletedAt) {
    throw deletedProblem("import", row);
  }
  return row;
}

export function importLocation(id: string) {
  return `/api/v2/imports/${id}`;
}

/** Until when the import command is active: while it is processed, and its end after that. */
export function importActiveUntil(row: Pick<Import, "createdAt" | "finishedAt">): Date {
  return row.finishedAt ?? new Date(Math.max(row.createdAt.getTime(), Date.now()));
}

export const ACCEPTED_IMPORT_HEADERS = {
  Location: { description: "The URL of the import.", schema: { type: "string" as const } },
  "Idempotency-Key-Expires-At": IDEMPOTENCY_EXPIRES_HEADER,
  "Idempotency-Replayed": IDEMPOTENCY_REPLAYED_HEADER,
};
