/**
 * Asking the validation service about the document a recording transmitted.
 *
 * A send is only refused when the validation service calls the document
 * *invalid*: the API sends on `valid`, on `not_supported`, and on the `error`
 * the client answers with when the service cannot be reached or does not
 * answer in a shape it understands. A recording of a send that went out is
 * therefore not proof that its document was ever held against the rules — only
 * that nothing refused it on the day it was made.
 *
 * That matters here because a replay refused by validation looks exactly like
 * a regression: the API answers 400 where the recording has something else.
 * Two very different things produce that. Either the API now builds a document
 * it did not build before — a regression, and the thing this suite exists to
 * catch — or it builds the same document as ever and the *verdict* on it has
 * moved: the service was unreachable when the recording was made, or its rules
 * have been updated since. Peppol publishes new Schematron twice a year, and
 * the day it lands, every recording of a document that the new rules refuse
 * fails here at once.
 *
 * The two are told apart by asking the service about the document the
 * recording itself carries. If it refuses that one under the same rules, in
 * the same places, then the document the API builds is not what changed and
 * there is nothing here for this suite to report. If it does not, the replay
 * is refused for something the recorded document does not do, and that is a
 * finding — so the recording fails, quoting both answers.
 *
 * Nothing is masked by this and nothing is skipped: it is one more question
 * put to the same service the send itself calls, asked only about a replay
 * that was already refused.
 */

import type { Recording } from "./recordings";

/** The same service the API validates against. */
export const VALIDATION_URL =
  process.env.REGRESSION_VALIDATION_URL?.trim() ||
  "https://validation.recommand.dev/validate";

/**
 * One rule that fired, at one place in the document. Both halves are compared:
 * the same rule failing somewhere else in the document is a different failure,
 * and saying so is what keeps this from waving through a regression that
 * happens to trip a rule the recorded document trips elsewhere.
 */
export type ValidationFailure = { field: string; rule: string };

export type RecordedDocumentVerdict = {
  /** Whether the recorded document is refused for everything the replay was. */
  explained: boolean;
  /** What the service answered about it, for the failure message. */
  description: string;
};

function sameFailure(a: ValidationFailure, b: ValidationFailure): boolean {
  return a.field === b.field && a.rule === b.rule;
}

function describe(failures: ValidationFailure[]): string {
  return failures.map(({ rule, field }) => `${rule} at ${field}`).join(", ");
}

/**
 * The rules a refusal names, or null when the refusal is not a validation
 * refusal at all — a request the API turned down before it built anything has
 * nothing to do with the rules and is compared as it always was.
 *
 * The body is the API's own: `errors.root` says validation failed, and every
 * other key is the path of an element, holding `<rule code>: <message>` for
 * each rule that fired there.
 */
export function validationRefusal(body: any): ValidationFailure[] | null {
  const errors = body?.errors;
  if (!errors || typeof errors !== "object") return null;
  const root = Array.isArray(errors.root) ? errors.root : [];
  if (!root.some((message: unknown) =>
    typeof message === "string" && message.startsWith("Document validation failed"),
  )) {
    return null;
  }

  const failures: ValidationFailure[] = [];
  for (const [field, messages] of Object.entries(errors)) {
    if (field === "root" || !Array.isArray(messages)) continue;
    for (const message of messages) {
      if (typeof message !== "string") continue;
      const rule = message.split(":", 1)[0]!.trim();
      if (rule) failures.push({ field, rule });
    }
  }
  return failures;
}

async function validate(
  xml: string,
): Promise<{ result: string; failures: ValidationFailure[] }> {
  const response = await fetch(VALIDATION_URL, {
    method: "POST",
    body: xml,
    headers: { "Content-Type": "application/xml" },
  });
  if (!response.ok) {
    throw new Error(`${VALIDATION_URL} answered ${response.status}`);
  }
  const body: any = await response.json();
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  return {
    result: typeof body?.result === "string" ? body.result : "unknown",
    failures: errors.map((error: any) => ({
      field: String(error?.fieldName ?? ""),
      rule: String(error?.ruleCode ?? ""),
    })),
  };
}

/**
 * Whether the document the recording transmitted is refused for everything the
 * replay was refused for.
 *
 * Returns null when the question does not arise: the replay was not refused by
 * validation, or the recording carries no document to ask about (a send that
 * was itself rejected stores none). The caller then reports the failure it
 * already had.
 */
export async function recordedDocumentVerdict(
  recording: Recording,
  replay: { status: number; body: any },
): Promise<RecordedDocumentVerdict | null> {
  if (replay.status !== 400) return null;
  const refusal = validationRefusal(replay.body);
  if (refusal === null) return null;
  if (recording.xmlDocument === null) return null;

  // A refusal that names no rule at all is still a refusal, and an empty list
  // would be "explained" by any document at all — so it never is.
  if (refusal.length === 0) {
    return {
      explained: false,
      description:
        "The replay was refused by validation without naming a rule, so there is nothing to hold the recorded document to.",
    };
  }

  let verdict: { result: string; failures: ValidationFailure[] };
  try {
    verdict = await validate(recording.xmlDocument);
  } catch (error) {
    return {
      explained: false,
      description:
        `The document this recording transmitted could not be validated to see whether it is refused too: ` +
        `${(error as Error).message}.`,
    };
  }

  const unexplained = refusal.filter(
    (failure) => !verdict.failures.some((other) => sameFailure(failure, other)),
  );
  if (unexplained.length === 0) {
    return {
      explained: true,
      description:
        `The document this recording transmitted is refused for the same rules today (${describe(refusal)}).`,
    };
  }

  return {
    explained: false,
    description:
      `The document this recording transmitted is not refused for ${describe(unexplained)} — ` +
      `the service calls it "${verdict.result}"` +
      (verdict.failures.length > 0
        ? ` and objects only to ${describe(verdict.failures)}.`
        : " and objects to nothing at all.") +
      ` So the replay is refused for something the recorded document does not do.`,
  };
}
