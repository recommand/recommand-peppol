import type { FrenchReportingStatus } from "@peppol/data/at/fr-reporting";

/**
 * When an e-reporting event is done with, and when it has to be looked at again.
 *
 * Kept free of the database and of the partner client so the rules can be tested on
 * their own and reused by support tooling that runs outside the application.
 *
 * What the reporting service confirmed about the lifecycle (Arratech, September 2026):
 * an event is carried on a period filing and reaches `filed` or `filed_rectificative`
 * when that filing is transmitted. The tax administration's answer arrives separately
 * as the outcome code, which moves on its own: first nothing, then `500` while the
 * deposit is being processed, then `300` once it is accepted. `501` is a refusal of
 * the deposit, which the reporting service's support has to resolve. The event is only
 * final once it is filed with outcome `300`, or once it is `rejected`. A filed event
 * without that outcome is still moving and stays under watch.
 */

export const FRENCH_REPORTING_OUTCOME_CODES = {
  /** The deposit reached the tax administration and is being processed. */
  received: "500",
  /** The deposit was refused; the reporting service's support has to resolve it. */
  depositRejected: "501",
  /** The deposit was accepted. Nothing more is heard about the events it carries. */
  accepted: "300",
} as const;

/**
 * What an outcome code means for the event that carries it. `301` deliberately reads as
 * `unrecognised`: the service has not said what it stands for, so it is neither treated
 * as final nor as in progress, and it is brought to support instead.
 */
export type FrenchReportingOutcomeMeaning =
  | "none"
  | "in_progress"
  | "final"
  | "needs_support"
  | "unrecognised";

export function describeFrenchReportingOutcome(
  outcomeCode: string | null | undefined,
): FrenchReportingOutcomeMeaning {
  if (!outcomeCode) return "none";
  if (outcomeCode === FRENCH_REPORTING_OUTCOME_CODES.received) return "in_progress";
  if (outcomeCode === FRENCH_REPORTING_OUTCOME_CODES.accepted) return "final";
  if (outcomeCode === FRENCH_REPORTING_OUTCOME_CODES.depositRejected) return "needs_support";
  return "unrecognised";
}

/** The statuses an event reaches when its period filing has been transmitted. */
export const FILED_REPORTING_STATUSES: ReadonlySet<FrenchReportingStatus> = new Set([
  "filed",
  "filed_rectificative",
]);

/** The statuses that are final on their own, whatever the outcome code says. */
export const SETTLED_REPORTING_STATUSES: ReadonlySet<FrenchReportingStatus> = new Set([
  "superseded",
  "rejected",
]);

export type FrenchReportingLifecycleState = {
  reportingStatus: FrenchReportingStatus;
  outcomeCode: string | null;
};

/**
 * Whether nothing more will be heard about an event. A filed event is final only once
 * the tax administration accepted the deposit that carries it; until then the outcome
 * can still turn into a refusal.
 */
export function isFrenchReportingFinal(state: FrenchReportingLifecycleState): boolean {
  if (SETTLED_REPORTING_STATUSES.has(state.reportingStatus)) {
    return true;
  }
  return (
    FILED_REPORTING_STATUSES.has(state.reportingStatus) &&
    state.outcomeCode === FRENCH_REPORTING_OUTCOME_CODES.accepted
  );
}

/** How long after its period's cutoff an event is still expected to reach a final state. */
export const STALE_AFTER_PERIOD_END_DAYS = 45;
export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;

/** The cutoff of a period: the end of its last day. Null when the period is not known. */
export function periodCutoff(periodEnd: string | null): Date | null {
  if (!periodEnd) return null;
  const cutoff = new Date(`${periodEnd}T23:59:59.999Z`);
  return Number.isNaN(cutoff.getTime()) ? null : cutoff;
}

/** Whether an event is long enough past its cutoff that waiting for it has stopped making sense. */
export function isStaleAfterCutoff(periodEnd: string | null, now: Date): boolean {
  const cutoff = periodCutoff(periodEnd);
  return cutoff !== null && now.getTime() - cutoff.getTime() > STALE_AFTER_PERIOD_END_DAYS * DAY;
}

/**
 * When to look at an event again. Kept pure so the cadence can be tested.
 *
 * Until the partner has placed the event in a period, the first look comes an hour
 * after filing. Inside the period nothing changes until the cutoff, so one look a
 * day is enough. After the cutoff the filing can happen at any moment, and the outcome
 * follows it on its own clock, so every six hours; and an event still not final long
 * after its cutoff is stale and stops being polled.
 */
export function planNextStatusCheck(
  submission: FrenchReportingLifecycleState & { periodEnd: string | null; simulated: boolean },
  now: Date = new Date(),
): Date | null {
  if (submission.simulated || isFrenchReportingFinal(submission)) {
    return null;
  }
  if (!submission.periodEnd) {
    return new Date(now.getTime() + HOUR);
  }
  const cutoff = periodCutoff(submission.periodEnd);
  if (!cutoff) {
    return new Date(now.getTime() + DAY);
  }
  if (now < cutoff) {
    return new Date(Math.min(cutoff.getTime() + HOUR, now.getTime() + DAY));
  }
  if (isStaleAfterCutoff(submission.periodEnd, now)) {
    return null;
  }
  return new Date(now.getTime() + 6 * HOUR);
}

/**
 * Whether a row that is no longer polled was stopped before its event was final.
 *
 * Earlier versions of the status worker treated `filed` as the end of the road and
 * stopped at it, before the tax administration had answered. Those rows carry an
 * outcome that is empty or still in progress and nothing looks at them any more. This
 * is the selection a recovery uses to give each of them one more look; it never files
 * or resends anything, and the planner takes over again after that look.
 */
export function wasStoppedBeforeFinal(row: {
  simulated: boolean;
  nextCheckAt: Date | null;
  reportingStatus: FrenchReportingStatus;
  outcomeCode: string | null;
}): boolean {
  return (
    !row.simulated &&
    row.nextCheckAt === null &&
    FILED_REPORTING_STATUSES.has(row.reportingStatus) &&
    !isFrenchReportingFinal(row)
  );
}
