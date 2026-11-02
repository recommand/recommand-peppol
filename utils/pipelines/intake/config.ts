// Limits of document intake. Start values: measure them with real traffic.

/** The largest file the API accepts, and the largest PDF from email the models get. */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
/** The most pages a PDF may have, at upload and before the models get it. */
export const MAX_PDF_PAGES = 100;
/**
 * How long a worker holds an import before another one may take it over. The worker
 * extends it after each stage, and every network call of a stage has a time limit (a
 * model call times out after `MODEL_CALL_TIMEOUT_MS`), so a live worker keeps its lease.
 * A worker that lost the import anyway no longer extends, retries or gives it up.
 */
export const LEASE_MS = 5 * 60 * 1000;
/** Imports one node processes at the same time; one at a time per company. */
export const MAX_CONCURRENT_IMPORTS = 4;
/**
 * Waits before the next try after a transient failure, one per retry. After the
 * last one, the pending results fail with `processing_unavailable`.
 */
export const RETRY_BACKOFF_MS = [
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
];
