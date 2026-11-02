// Shapes that document intake stores and returns. They follow the Services API v2
// models of the same name: an import, its results, the files they point at, and the
// failures and findings of processing.

export const importChannels = ["api", "email"] as const;

export const importStatuses = [
  "queued",
  "processing",
  "completed",
  "partially_completed",
  "failed",
  "ignored",
] as const;
export type ImportStatus = (typeof importStatuses)[number];

export const FINAL_IMPORT_STATUSES: readonly ImportStatus[] = [
  "completed",
  "partially_completed",
  "failed",
  "ignored",
];

export const importResultStatuses = ["pending", "document", "failed", "ignored"] as const;
export type ImportResultStatus = (typeof importResultStatuses)[number];

export const inboundAddressStatuses = ["provisioning", "active", "failed"] as const;
export type InboundAddressStatus = (typeof inboundAddressStatuses)[number];

export const documentSourceChannels = ["peppol", "email", "api"] as const;

export const processingMethods = ["parsed", "extracted"] as const;
export type ProcessingMethod = (typeof processingMethods)[number];

export type Issue = {
  code: string;
  message: string;
  pointer?: string;
};

/** Why an import or one of its results could not produce a document. */
export type Failure = {
  code: string;
  message: string;
  issues?: Issue[];
  context?: Record<string, unknown>;
};

/** A remark about a published document that did not stop its publication. */
export type Finding = {
  code: string;
  severity: "info" | "warning" | "error";
  scope: "extraction" | "business";
  message: string;
  pointer?: string;
};

export type SourceRange = { type: "pages"; from: number; to: number } | null;

/** Where a result comes from: a file, its role and, later, the part of it. */
export type SourceLocation = {
  fileId: string;
  role: "primary" | "supporting";
  range: SourceRange;
};

export type FileProvenance =
  | { kind: "source" }
  | {
      kind: "derived";
      operation: "unwrap";
      inputs: { fileId: string; range: SourceRange }[];
    };

/** What a file's bytes are, as far as intake recognises them. */
export type FileFormat = "pdf" | "ubl" | "cii" | "xml" | "mime";

/** How an import arrived: the API request or the email that carried it. */
export type ImportSource =
  | { channel: "api"; requestId: string }
  | {
      channel: "email";
      from: string | null;
      to: string;
      subject: string | null;
      receivedAt: string | null;
      authentication: { spf: string | null; dkim: string | null };
    };
