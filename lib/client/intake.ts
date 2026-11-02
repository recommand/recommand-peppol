import type { TranslationFunction } from "@core/lib/translations";

// The v2 intake API as the dashboard uses it. v2 responses carry no success envelope
// and report errors as Problem Details, so they are read with fetch rather than the
// typed v1 client.

export type ImportStatus = "queued" | "processing" | "completed" | "partially_completed" | "failed" | "ignored";

export type Failure = {
  code: string;
  message: string;
  issues?: { code: string; message: string; pointer?: string }[];
  context?: Record<string, unknown>;
};

export type FileReference = { id: string; filename: string; mediaType: string; size: number };

export type Import = {
  id: string;
  revision: number;
  companyId: string;
  status: ImportStatus;
  createdAt: string;
  updatedAt: string;
  source:
    | { channel: "api"; recordedAt: string; requestId: string | null }
    | {
        channel: "email";
        recordedAt: string;
        from: string | null;
        to: string;
        subject: string | null;
        receivedAt: string | null;
      };
  files: FileReference[];
  resultCounts: { documents: number; failed: number };
  error: Failure | null;
};

export type ImportResult = {
  id: string;
  locations: { fileId: string; role: "primary" | "supporting"; range: unknown }[];
  documentId: string | null;
  error: Failure | null;
};

export type InboundAddress = {
  id: string;
  companyId: string;
  address: string;
  enabled: boolean;
  status: string;
  acceptedTypes: string[] | null;
  createdAt: string;
};

export type Page<T> = { data: T[]; nextCursor: string | null };

export class V2Error extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
  }
}

export async function v2Request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v2${path}`, { credentials: "include", ...init });
  if (response.status === 204) {
    return undefined as T;
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new V2Error(body?.detail ?? response.statusText, response.status, body?.code ?? null);
  }
  return body as T;
}

export function jsonRequest(method: string, body: unknown, idempotent = false): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(idempotent ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: JSON.stringify(body),
  };
}

/** Download a file of an import, under its own name. */
export async function downloadImportFile(file: FileReference) {
  const response = await fetch(`/api/v2/files/${file.id}/content`, { credentials: "include" });
  if (!response.ok) {
    throw new V2Error(response.statusText, response.status, null);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function isImportFinished(status: ImportStatus) {
  return status !== "queued" && status !== "processing";
}

export function importStatusLabel(t: TranslationFunction, status: ImportStatus): string {
  const labels: Record<ImportStatus, string> = {
    queued: t("Queued"),
    processing: t("Processing"),
    completed: t("Completed"),
    partially_completed: t("Partially completed"),
    failed: t("Failed"),
    ignored: t("Ignored"),
  };
  return labels[status] ?? status;
}

/** What a failure code means, for the people reading the dashboard. */
export function failureLabel(t: TranslationFunction, code: string): string {
  const labels: Record<string, string> = {
    input_unreadable: t("None of the files can be read"),
    file_unreadable: t("The file cannot be read"),
    file_too_large: t("The file is too large"),
    page_limit_exceeded: t("The PDF has too many pages"),
    input_rejected: t("The document could not be processed"),
    unsupported_format: t("The XML format is not supported"),
    unsupported_document_type: t("This type of document is not supported"),
    classification_uncertain: t("The type of document could not be recognised"),
    type_mismatch: t("The document is not of the expected type"),
    multiple_messages_detected: t("The PDF contains more than one document"),
    extraction_invalid: t("The content could not be read correctly"),
    insufficient_evidence: t("The document does not show enough to identify it"),
    processing_unavailable: t("Processing was temporarily unavailable"),
  };
  return labels[code] ?? code;
}
