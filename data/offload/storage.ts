import { transmittedDocuments } from "@peppol/db/schema";
import { downloadFile } from "@core/lib/s3";
import type { Attachment } from "@peppol/utils/parsing/invoice/schemas";
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

// Root of all offloaded document objects. Every document object lives under
// the prefix of its team and company, which lets the deletion worker remove
// all of a company's (or team's) objects by prefix without enumerating keys
// from the database. The deletion queue relies on this layout staying stable.
export const PEPPOL_DOCUMENTS_S3_ROOT = "peppol-documents";

export function teamDocumentsS3Prefix(teamId: string): string {
  return `${PEPPOL_DOCUMENTS_S3_ROOT}/${teamId}/`;
}

export function companyDocumentsS3Prefix(
  teamId: string,
  companyId: string
): string {
  return `${teamDocumentsS3Prefix(teamId)}${companyId}/`;
}

// Derive the canonical S3 key prefix for a document. Called once, at offload
// time; the result is persisted to s3KeyPrefix and used for all later reads.
// Document ids are fixed-length ULIDs, so one document's prefix can never be
// a prefix of another's; prefix-deleting it removes exactly this document's
// objects.
export function documentS3KeyPrefix(doc: DocumentS3Locator): string {
  const d = doc.createdAt;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${companyDocumentsS3Prefix(doc.teamId, doc.companyId)}${yyyy}/${mm}/${dd}/${doc.id}`;
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

export function hydrateDocumentParsedAttachments<T>(
  parsed: T,
  attachments: Attachment[]
): T {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("attachments" in parsed)
  ) {
    return parsed;
  }
  return { ...parsed, attachments };
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
  return hydrateDocumentParsedAttachments(doc.parsed, attachments);
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

// The s3KeyPrefix of each document that has at least one payload in S3. These
// are the prefixes to enqueue for background deletion when the documents are
// deleted; documents that were never offloaded have nothing in S3.
export function offloadedDocumentS3Prefixes(
  docs: OffloadedDocumentLocator[]
): string[] {
  const prefixes: string[] = [];
  for (const doc of docs) {
    if (!doc.s3KeyPrefix) continue;
    if (doc.xmlLocation === "s3" || doc.attachmentsLocation === "s3") {
      prefixes.push(doc.s3KeyPrefix);
    }
  }
  return prefixes;
}
