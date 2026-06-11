import { transmittedDocuments } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, eq, or } from "drizzle-orm";
import { deleteFile, downloadFile } from "@core/lib/s3";
import type { Attachment } from "@peppol/utils/parsing/invoice/schemas";
import { S3_REQUEST_CONCURRENCY, mapWithConcurrency } from "@peppol/utils/concurrency";
import { withTimeout } from "@peppol/utils/timeout";

// Upper bound on any single S3 request before we give up on it, protecting
// against a request that hangs indefinitely (a stalled connection never
// returning) from blocking a worker or a user-facing request forever.
export const S3_OPERATION_TIMEOUT_MS = 60_000;

// ----------------------------------------------------------------------------
// Document payload storage. The raw xml and the (potentially heavy)
// parsed.attachments of a transmitted document are kept in the database for fast
// access and gradually offloaded to S3 by a background worker (see ./index).
// These helpers derive the S3 keys, resolve a payload from wherever it currently
// lives (database or S3), and clean up the S3 objects when documents are deleted.
// ----------------------------------------------------------------------------

export type PayloadLocation = "none" | "db" | "s3";

type DocumentS3Locator = {
  id: string;
  teamId: string;
  companyId: string;
  createdAt: Date;
};

// Derive the canonical S3 key prefix for a document. Called once, at offload
// time; the result is persisted to s3KeyPrefix and used for all later reads.
export function documentS3KeyPrefix(doc: DocumentS3Locator): string {
  const d = doc.createdAt;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `peppol-documents/${doc.teamId}/${doc.companyId}/${yyyy}/${mm}/${dd}/${doc.id}`;
}

export function documentXmlKey(s3KeyPrefix: string): string {
  return `${s3KeyPrefix}.xml`;
}

export function documentAttachmentsKey(s3KeyPrefix: string): string {
  return `${s3KeyPrefix}.attachments.json`;
}

// Whether a parsed document carries any embedded attachments.
export function parsedHasAttachments(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || !("attachments" in parsed)) {
    return false;
  }
  const attachments = (parsed as { attachments?: unknown }).attachments;
  return Array.isArray(attachments) && attachments.length > 0;
}

// An offloaded payload must always have a stored prefix; this guards the invariant.
function requireS3KeyPrefix(doc: { s3KeyPrefix: string | null }): string {
  if (!doc.s3KeyPrefix) {
    throw new Error("Offloaded document is missing its s3KeyPrefix");
  }
  return doc.s3KeyPrefix;
}

// Resolve the raw xml body based on where it lives: in this row, in S3, or
// nowhere (there was no xml).
export async function resolveDocumentXml(
  doc: { xml: string | null; xmlLocation: PayloadLocation; s3KeyPrefix: string | null }
): Promise<string | null> {
  switch (doc.xmlLocation) {
    case "db":
      return doc.xml;
    case "s3": {
      const file = await downloadFile(documentXmlKey(requireS3KeyPrefix(doc)));
      return await withTimeout(
        file.text(),
        S3_OPERATION_TIMEOUT_MS,
        "Read offloaded document xml from S3"
      );
    }
    case "none":
      return null;
  }
}

// Resolve the parsed attachments based on where they live: in the parsed
// payload or in S3. Returns [] (never null) when there are none, matching the
// shape parsing produces for attachment-free documents.
export async function resolveDocumentAttachments(
  doc: { parsed: unknown; attachmentsLocation: PayloadLocation; s3KeyPrefix: string | null }
): Promise<Attachment[]> {
  switch (doc.attachmentsLocation) {
    case "db":
      return (doc.parsed as { attachments?: Attachment[] | null } | null)
        ?.attachments ?? [];
    case "s3": {
      const file = await downloadFile(documentAttachmentsKey(requireS3KeyPrefix(doc)));
      const json = await withTimeout(
        file.text(),
        S3_OPERATION_TIMEOUT_MS,
        "Read offloaded document attachments from S3"
      );
      return JSON.parse(json) as Attachment[];
    }
    case "none":
      return [];
  }
}

// Resolve a document's xml and attachments together. The two payloads live in
// separate S3 objects, so fetch them concurrently rather than stacking the
// round-trip latencies.
export async function resolveDocumentXmlAndAttachments(
  doc: {
    xml: string | null;
    xmlLocation: PayloadLocation;
    parsed: unknown;
    attachmentsLocation: PayloadLocation;
    s3KeyPrefix: string | null;
  }
): Promise<{ xml: string | null; attachments: Attachment[] }> {
  const [xml, attachments] = await Promise.all([
    resolveDocumentXml(doc),
    resolveDocumentAttachments(doc),
  ]);
  return { xml, attachments };
}

// Return a copy of the parsed document with its attachments resolved from
// wherever they live, normalised so the API shape matches a never-offloaded
// document. Offloading strips an empty attachments list to null in the database;
// here an attachment-bearing document always exposes an array again, so clients
// keep reading parsed.attachments without a null check. Documents that never
// carry attachments (e.g. message-level responses) are left untouched.
export async function resolveDocumentParsedWithAttachments<T>(
  doc: { parsed: T; attachmentsLocation: PayloadLocation; s3KeyPrefix: string | null }
): Promise<T> {
  if (
    !doc.parsed ||
    typeof doc.parsed !== "object" ||
    !("attachments" in doc.parsed)
  ) {
    return doc.parsed;
  }
  const attachments =
    doc.attachmentsLocation === "s3"
      ? await resolveDocumentAttachments(doc)
      : (doc.parsed as { attachments?: Attachment[] | null }).attachments ?? [];
  return { ...doc.parsed, attachments };
}

type OffloadedDocumentLocator = {
  xmlLocation: PayloadLocation;
  attachmentsLocation: PayloadLocation;
  s3KeyPrefix: string | null;
};

// Columns needed to compute the S3 keys of a document's offloaded payloads.
export const offloadedDocumentSelect = {
  xmlLocation: transmittedDocuments.xmlLocation,
  attachmentsLocation: transmittedDocuments.attachmentsLocation,
  s3KeyPrefix: transmittedDocuments.s3KeyPrefix,
};

// The S3 object keys for the payloads of these documents that live in S3.
export function offloadedDocumentS3Keys(
  docs: OffloadedDocumentLocator[]
): string[] {
  const keys: string[] = [];
  for (const doc of docs) {
    if (!doc.s3KeyPrefix) continue;
    if (doc.xmlLocation === "s3") keys.push(documentXmlKey(doc.s3KeyPrefix));
    if (doc.attachmentsLocation === "s3")
      keys.push(documentAttachmentsKey(doc.s3KeyPrefix));
  }
  return keys;
}

// Best-effort deletion of offloaded S3 objects. Never throws: an orphaned object
// is a minor storage cost, not a correctness problem, and must not block the
// (already committed or about-to-happen) deletion of the database rows.
// Concurrency is bounded so deleting a company (or a large batch) with many
// thousands of offloaded documents does not fire all the requests at once.
export async function deleteOffloadedDocumentObjects(
  keys: string[]
): Promise<void> {
  await mapWithConcurrency(keys, S3_REQUEST_CONCURRENCY, (key) =>
    withTimeout(
      deleteFile(key),
      S3_OPERATION_TIMEOUT_MS,
      `Delete offloaded document object ${key}`
    ).catch((error) => {
      console.error(
        `Failed to delete offloaded document object ${key}:`,
        error
      );
    })
  );
}

// Collect the offloaded S3 keys for all documents belonging to a company. Used
// before a company (and its documents, via cascade) is deleted.
export async function getOffloadedDocumentS3KeysForCompany(
  teamId: string,
  companyId: string
): Promise<string[]> {
  const docs = await db
    .select(offloadedDocumentSelect)
    .from(transmittedDocuments)
    .where(
      and(
        eq(transmittedDocuments.teamId, teamId),
        eq(transmittedDocuments.companyId, companyId),
        or(
          eq(transmittedDocuments.xmlLocation, "s3"),
          eq(transmittedDocuments.attachmentsLocation, "s3")
        )
      )
    );
  return offloadedDocumentS3Keys(docs);
}
