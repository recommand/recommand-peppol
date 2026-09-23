import type { FrenchReportingStatus } from "@peppol/data/at/fr-reporting";
import type { F10Action } from "@peppol/utils/parsing/fr-reporting/shared";

/**
 * A payment report a company filed earlier on the same invoice, as far as the guard
 * needs to know it: which action it was, and whether it is still the report on file.
 */
export type EarlierFrenchPaymentReport = {
  documentId: string;
  reference: string;
  action: F10Action;
  date: string;
  /** Null when the report was never recorded to be followed, which reads as still on file. */
  reportingStatus: FrenchReportingStatus | null;
};

/**
 * What a cross-border payment report turns out to be next to the payment reports
 * already on file for its invoice.
 *
 * The reporting service keeps one payment event per invoice. A second payment event
 * on the same invoice replaces the earlier one; it is not added to it. Separate
 * instalments on one invoice are not supported yet on the service's side. A customer
 * who reports two instalments as two plain `submit`s would therefore end up with only
 * the second one on file, silently. That request is refused here, before anything
 * reaches the service, and the customer is told what the service would have done.
 *
 * What still goes through: a retry of the same report under the same reference,
 * which the service answers with the report filed the first time; an explicit
 * `correct`, which is the customer saying the report on file is to be replaced; a
 * `cancel`; and a new report after a cancellation, which starts over. Nothing here decides what the replacing report should contain: whether
 * that is the latest instalment or the total received is the tax question the
 * service has not answered, and it is not answered for the customer here either.
 */
export type FrenchPaymentInstalmentAssessment =
  | { kind: "first"; refusal: null }
  | { kind: "retry"; refusal: null }
  | { kind: "replacement"; refusal: null }
  | { kind: "cancellation"; refusal: null }
  | { kind: "second_instalment"; refusal: string };

/**
 * The report the service still holds for the invoice, if any. `earlier` is newest
 * first. A cancellation the service accepted withdraws what came before it, so it
 * ends the search even while the original has not yet been polled back as
 * `superseded`: nothing here writes that status, only the status worker does, and
 * that can be a day away. Whether the cancellation is fully processed on the
 * service's side is left to the service: it refuses a new report itself if not.
 */
function findOnFile(earlier: EarlierFrenchPaymentReport[]): EarlierFrenchPaymentReport | null {
  for (const report of earlier) {
    if (report.action === "cancel") {
      return null;
    }
    if (report.reportingStatus !== "superseded") {
      return report;
    }
  }
  return null;
}

export function assessFrenchPaymentInstalment({
  earlier,
  submitted,
}: {
  earlier: EarlierFrenchPaymentReport[];
  submitted: { reference: string; action: F10Action; invoiceNumber: string; date: string };
}): FrenchPaymentInstalmentAssessment {
  if (earlier.some((report) => report.reference === submitted.reference)) {
    // The reference is the idempotency key: the service answers a replayed reference
    // with the original event and files nothing, and the duplicate assessment that
    // follows tells a retry from a reused reference.
    return { kind: "retry", refusal: null };
  }
  if (submitted.action === "cancel") {
    return { kind: "cancellation", refusal: null };
  }
  if (submitted.action === "correct") {
    return { kind: "replacement", refusal: null };
  }
  const onFile = findOnFile(earlier);
  if (!onFile) {
    return { kind: "first", refusal: null };
  }
  return {
    kind: "second_instalment",
    refusal: `A payment report is already on file for invoice ${submitted.invoiceNumber} (reference "${onFile.reference}", payment received ${onFile.date}). The reporting service keeps one payment event per invoice: a second payment report on the same invoice replaces the earlier one instead of being added to it, so it cannot report a further instalment. Nothing was filed for this request. To replace the report on file, send this report with \`action: "correct"\` under a new reference; to withdraw it, send \`action: "cancel"\`. Reporting separate instalments on one invoice is not supported by the reporting service yet.`,
  };
}
