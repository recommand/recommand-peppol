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
