import { z } from "zod";
import "zod-openapi/extend";
import { decimalSchema } from "@peppol/utils/parsing/invoice/schemas";

/**
 * Constraints every French e-reporting (Flux 10) event shares. They mirror what the
 * reporting partner validates strictly, so a report that passes here is not
 * rejected there for its shape: references are at most 128 characters, and amounts
 * and percentages are non-negative decimals with exactly two fractional digits.
 */

export const F10_REFERENCE_MAX_LENGTH = 128;

export const f10ReferenceSchema = z
  .string()
  .min(1)
  .max(F10_REFERENCE_MAX_LENGTH)
  .openapi({
    example: "SALES-2026-07-01-GOODS",
    description:
      "Your unique reference for this submission, at most 128 characters. It is the idempotency key: retrying the exact same request with the same reference files nothing again and returns the report filed the first time, with `duplicate: true`. Every new submission, corrections and cancellations included, needs its own reference.",
  });

/** A monetary amount as the tax administration expects it: "1234.50", never negative. */
export const f10AmountSchema = decimalSchema.refine(
  (value) => /^\d+\.\d{2}$/.test(value),
  { message: "Amount must be a non-negative number with at most two decimals" },
);

/** A VAT rate as the tax administration expects it: "20.00". */
export const f10PercentSchema = decimalSchema.refine(
  (value) => /^\d+\.\d{2}$/.test(value),
  { message: "Percentage must be a non-negative number with at most two decimals" },
);

export const f10ActionSchema = z
  .enum(["submit", "correct", "cancel"])
  .default("submit")
  .openapi({
    example: "submit",
    description:
      "Use `submit` for a new report, `correct` to replace a report you filed earlier for the same period or document, or `cancel` to cancel it. Corrections and cancellations are matched on the data that identifies the report (for example the day and category of a daily total, or the document number of an invoice), and always need a new `reference`. Defaults to `submit`.",
  });

export type F10Action = z.infer<typeof f10ActionSchema>;

/**
 * Member states of the European Union. A buyer established in one of them is
 * identified by its intra-community VAT number in cross-border reports.
 */
export const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export function isEuCountry(country: string): boolean {
  return EU_COUNTRY_CODES.has(country.toUpperCase());
}
