// Postgres unique violation. Raised when two writers record the same thing at once,
// which the unique indexes turn into an error instead of a duplicate row.
const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/** The SQLSTATE of a PostgreSQL error, also when Drizzle wrapped it in a `DrizzleQueryError` as its cause. */
function postgresErrorCode(error: unknown): string | null {
  for (let current = error, depth = 0; typeof current === "object" && current !== null && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * A data exception (SQLSTATE class 22): a value of the statement is invalid, such as a
 * NUL character in text. The same values fail the same way every time, so retrying the
 * statement cannot help.
 */
export function isDataException(error: unknown): boolean {
  return postgresErrorCode(error)?.startsWith("22") ?? false;
}
