import type { Issue } from "@peppol/types/intake";
import { decimal } from "./billing-intake";

// Helpers for the AI intake rules of the document types that state few or no amounts,
// such as the order and the despatch advice.

/** A negative quantity in one of the fields of a line: these types state quantities as positive numbers. */
export function negativeQuantityIssues(document: unknown, fields: string[]): Issue[] {
  const lines = (document as { lines?: Record<string, unknown>[] } | null)?.lines;
  if (!Array.isArray(lines)) {
    return [];
  }
  return lines.flatMap((line, index) =>
    fields
      .filter((field) => decimal(line?.[field] as string | null | undefined)?.isNegative())
      .map((field) => ({
        code: "negative_quantity",
        message: `The ${field} ${line[field]} is negative. Write the quantity as a positive number.`,
        pointer: `/lines/${index}/${field}`,
      })),
  );
}
