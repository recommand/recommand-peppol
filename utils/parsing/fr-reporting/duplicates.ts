import {
  storedFrenchB2BiReportSchema,
  type StoredFrenchB2BiReport,
} from "@peppol/utils/parsing/b2bi-reporting/france";
import {
  frenchB2CReportSchema,
  type FrenchB2CReport,
} from "@peppol/utils/parsing/b2c-reporting/france";
import type { FrenchB2BiReport } from "@peppol/utils/parsing/b2bi-reporting/france";

/** A report as it was stored, which for invoice reports may predate `billingMode`. */
export type StoredFrenchReport = FrenchB2CReport | StoredFrenchB2BiReport;

/**
 * What a report submitted under a reference that was already used turns out to be.
 *
 * The reference is the idempotency key, so a second use of it answers with the report
 * filed the first time and files nothing. That is what a retry after a timeout needs.
 * It is also what happens when a correction or a cancellation is sent under the
 * reference of the report it means to act on, and then nothing changes. The cases are
 * told apart by comparing this request with the report that was actually filed.
 */
export type FrenchReportDuplicateAssessment =
  | { kind: "retry"; warning: null }
  | { kind: "different_action"; warning: string }
  | { kind: "different_content"; warning: string }
  | { kind: "unverified_billing_mode"; warning: string }
  | { kind: "unknown_original"; warning: string };

/**
 * The comparable form of a report: keys in a fixed order, and fields carrying no value
 * left out, so an omitted field and an explicit null read alike. Array order is kept,
 * because the order of a VAT breakdown is part of what was filed.
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== null && entry !== undefined)
    .map(([key, entry]) => [key, canonicalise(entry)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(entries);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

/**
 * The stored report, read back through the schema it was stored under so both sides of
 * a comparison carry the same defaults. Fields outside the schema are dropped on both
 * sides alike, so they cannot make two equal reports look different.
 *
 * Returns null when the stored data cannot be read as a report; nothing is then
 * claimed about what was filed.
 */
export function readStoredFrenchReport(stored: unknown): StoredFrenchReport | null {
  const b2c = frenchB2CReportSchema.safeParse(stored);
  if (b2c.success) {
    return b2c.data;
  }
  const b2bi = storedFrenchB2BiReportSchema.safeParse(stored);
  if (b2bi.success) {
    return b2bi.data;
  }
  return null;
}

const requestedActionWording = {
  submit: "report",
  correct: "correction",
  cancel: "cancellation",
} as const;

const filedActionWording = {
  submit: "submitted",
  correct: "corrected",
  cancel: "cancelled",
} as const;

function withoutBillingMode(record: Record<string, unknown>): Record<string, unknown> {
  const { billingMode: _billingMode, ...rest } = record;
  return rest;
}

/**
 * Compares a report submitted under an already used reference with the report that
 * reference filed. A correction or a cancellation is never presented as successful
 * when the reference belonged to something else: nothing was filed for it.
 *
 * An invoice report filed before the invoicing framework was asked for carries none,
 * and what it would have been cannot be derived from what was stored. The rest of the
 * report is still compared, and the framework is reported as unverified rather than
 * assumed to match.
 */
export function assessFrenchReportDuplicate({
  stored,
  submitted,
}: {
  stored: unknown;
  submitted: FrenchB2CReport | FrenchB2BiReport;
}): FrenchReportDuplicateAssessment {
  const original = readStoredFrenchReport(stored);
  if (!original) {
    return {
      kind: "unknown_original",
      warning: `Reference "${submitted.reference}" was already used, so nothing was filed for this request. The earlier report could not be read back for comparison, so check the report returned here before treating this request as filed.`,
    };
  }

  if (original.action !== submitted.action) {
    return {
      kind: "different_action",
      warning: `Nothing was filed for this request. Reference "${submitted.reference}" was already used for a report that was ${filedActionWording[original.action]}, and a reference can only be used once. The report returned here is that earlier one, unchanged. Send this ${requestedActionWording[submitted.action]} again under a new reference.`,
    };
  }

  const originalRecord = original as unknown as Record<string, unknown>;
  const submittedRecord = submitted as unknown as Record<string, unknown>;
  const billingModeUnverifiable =
    originalRecord.billingMode === undefined && submittedRecord.billingMode !== undefined;

  const comparableOriginal = billingModeUnverifiable
    ? withoutBillingMode(originalRecord)
    : originalRecord;
  const comparableSubmitted = billingModeUnverifiable
    ? withoutBillingMode(submittedRecord)
    : submittedRecord;

  if (canonicalJson(comparableOriginal) !== canonicalJson(comparableSubmitted)) {
    return {
      kind: "different_content",
      warning: `Nothing was filed for this request. Reference "${submitted.reference}" was already used for a report with different contents, and the report returned here is the one filed the first time. Use a new reference for a report that is not a retry of an earlier one.`,
    };
  }

  if (billingModeUnverifiable) {
    return {
      kind: "unverified_billing_mode",
      warning: `Nothing was filed for this request: reference "${submitted.reference}" was already used, and the report returned here is the one filed the first time. That report was filed without an invoicing framework, so the \`billingMode\` sent now could not be compared with it and the framework on file is unknown. If the report on file needs a different framework, file a correction under a new reference.`,
    };
  }

  return { kind: "retry", warning: null };
}
