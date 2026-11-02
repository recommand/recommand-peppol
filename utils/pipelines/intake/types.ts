import type { Company } from "@peppol/data/companies";
import type { ImportFile } from "@peppol/data/imports/files";
import type { Import } from "@peppol/data/imports/imports";
import type { AttemptRecord, ImportResult } from "@peppol/data/imports/results";
import type { Failure, Finding, ProcessingMethod, SourceLocation } from "@peppol/types/intake";
import type { ValidationResponse } from "@peppol/types/validation";

export type StageName = "structured" | "text" | "classify" | "extract" | "check" | "publish";

/** The XML of a result, parsed with a registered format. */
export type ParsedXml = {
  formatKey: string;
  type: string;
  processId: string;
  document: unknown;
  /** The file the XML is in: the primary file, or the file unwrapped from a PDF. */
  xmlFileId: string;
};

/** No XML: the result goes the AI path. */
export type StructuredCheckpoint = ({ method: "parsed" } & ParsedXml) | { method: null };

export type TextCheckpoint = { text: string; pageCount: number; textHash: string };

export type ClassifyCheckpoint = {
  type: string;
  probability: number;
  probabilities: Record<string, number>;
  model: string;
};

export type ExtractCheckpoint = {
  document: unknown;
  findings: Finding[];
  model: string;
};

/**
 * The document to publish, parsed with its type's schema, and what the checks found.
 * An extracted document carries the validation of its encoded XML.
 */
export type CheckCheckpoint = { document: unknown; findings: Finding[]; validation?: ValidationResponse };

export type Checkpoints = {
  structured?: StructuredCheckpoint;
  text?: TextCheckpoint;
  classify?: ClassifyCheckpoint;
  extract?: ExtractCheckpoint;
  check?: CheckCheckpoint;
};

/** What a stage of one result works with. */
export type ResultContext = {
  importRow: Import;
  company: Company;
  result: ImportResult;
  checkpoints: Checkpoints;
  /** Every file of the import, by id. */
  files: Map<string, ImportFile>;
  primaryFile: ImportFile;
  /** The bytes of a file of the import, read once. */
  readFile: (fileId: string) => Promise<Buffer>;
  /** Add a location to the result, saved with the next checkpoint. */
  addLocation: (location: SourceLocation) => void;
  /** Make a file known to the context, for a file a stage derived. */
  addFile: (file: ImportFile) => void;
  recordAttempt: (attempt: Omit<AttemptRecord, "importId" | "resultId">) => Promise<void>;
};

export type StageOutcome =
  | { checkpoint: unknown }
  | { ignored: string }
  | { failure: Failure }
  | { published: string };

/**
 * One step of processing a result. A stage that does not apply to a result is skipped
 * without a checkpoint; a stage that throws is retried later, from its own start, unless
 * the error is permanent (`PermanentStageError`), which fails the result.
 */
export type Stage = {
  name: StageName;
  applies?: (context: ResultContext) => boolean;
  run: (context: ResultContext) => Promise<StageOutcome>;
};

/** The parsed or extracted document a result publishes, and how it was read. */
export function processingMethodOf(checkpoints: Checkpoints): ProcessingMethod {
  return checkpoints.structured?.method === "parsed" ? "parsed" : "extracted";
}

export function failure(code: string, message: string, context?: Record<string, unknown>): Failure {
  return context ? { code, message, context } : { code, message };
}
