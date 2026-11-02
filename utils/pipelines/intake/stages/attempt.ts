import type { Failure } from "@peppol/types/intake";
import type { ModelUsage } from "../models/jev";
import { failure, type ResultContext, type StageName } from "../types";

// Answers of the model service that refuse the request itself, such as a file that is
// too large or that the model cannot take. Sending the same request again gives the
// same answer. Other errors (network, timeouts, 408, 429, 5xx, and authentication or
// account errors that an operator can fix) are retried.
const PERMANENT_STATUS_CODES = new Set([400, 413, 415, 422]);

/** A model call that will not succeed on a retry: the result fails at once. */
export class PermanentStageError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message);
    this.name = "PermanentStageError";
  }
}

function permanentStatusCode(error: unknown): number | null {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === "number" && PERMANENT_STATUS_CODES.has(statusCode) ? statusCode : null;
}

/** Run a model call and record it as an attempt of the stage, also when it fails. */
export async function withAttempt<T extends { model: string; usage: ModelUsage }>(
  context: ResultContext,
  stage: StageName,
  call: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  const durationMs = () => Date.now() - startedAt.getTime();
  try {
    const result = await call();
    await context.recordAttempt({ stage, model: result.model, startedAt, durationMs: durationMs(), ...result.usage });
    return result;
  } catch (error) {
    await context.recordAttempt({
      stage,
      model: null,
      startedAt,
      durationMs: durationMs(),
      error: error instanceof Error ? error.message : String(error),
    });
    const statusCode = permanentStatusCode(error);
    if (statusCode !== null) {
      throw new PermanentStageError(
        failure("input_rejected", "The model service refused the document. Processing it again gives the same answer.", {
          stage,
          statusCode,
        }),
      );
    }
    throw error;
  }
}
