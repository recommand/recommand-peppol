import { describe, expect, it, mock } from "bun:test";

// The scheduling and status rules are pure; the database is never touched here.
mock.module("@recommand/db", () => ({ db: {} }));
mock.module("@core/data/rules/events", () => ({ publishEvent: async () => {} }));

const {
  applyStatusReport,
  isFrenchReportingFinal,
  operationalAlertKey,
  planNextStatusCheck,
  wasStoppedBeforeFinal,
} = await import("../data/fr-reporting-submissions");
const { describeFrenchReportingOutcome, FILED_REPORTING_STATUSES, SETTLED_REPORTING_STATUSES } =
  await import("../utils/parsing/fr-reporting/lifecycle");
const { createAlertSuppressor } = await import("../utils/system-notifications/suppression");

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe("French reporting status polling", () => {
  it("looks an hour after filing when the period is not known yet", () => {
    const now = new Date("2026-09-08T10:00:00Z");
    const next = planNextStatusCheck(
      { reportingStatus: "accepted", outcomeCode: null, periodEnd: null, simulated: false },
      now,
    );
    expect(next?.getTime()).toBe(now.getTime() + HOUR);
  });

  it("looks daily inside the period and every six hours after its cutoff", () => {
    const inside = new Date("2026-09-08T10:00:00Z");
    const next = planNextStatusCheck(
      { reportingStatus: "accepted", outcomeCode: null, periodEnd: "2026-09-30", simulated: false },
      inside,
    );
    expect(next?.getTime()).toBe(inside.getTime() + DAY);

    const nearCutoff = new Date("2026-09-30T20:00:00Z");
    const soon = planNextStatusCheck(
      { reportingStatus: "accepted", outcomeCode: null, periodEnd: "2026-09-30", simulated: false },
      nearCutoff,
    );
    // Never later than an hour past the cutoff.
    expect(soon?.toISOString()).toBe("2026-10-01T00:59:59.999Z");

    const after = new Date("2026-10-03T10:00:00Z");
    const later = planNextStatusCheck(
      { reportingStatus: "pending_rectificative", outcomeCode: null, periodEnd: "2026-09-30", simulated: false },
      after,
    );
    expect(later?.getTime()).toBe(after.getTime() + 6 * HOUR);
  });

  it("keeps looking at a filed event until the tax administration has accepted its filing", () => {
    // Filed in early October; the outcome follows on its own clock.
    const now = new Date("2026-10-03T10:00:00Z");
    for (const status of FILED_REPORTING_STATUSES) {
      for (const outcomeCode of [null, "", "500"]) {
        expect(
          planNextStatusCheck(
            { reportingStatus: status, outcomeCode, periodEnd: "2026-09-30", simulated: false },
            now,
          )?.getTime(),
        ).toBe(now.getTime() + 6 * HOUR);
      }
      // Accepted by the tax administration: nothing more will be heard.
      expect(
        planNextStatusCheck(
          { reportingStatus: status, outcomeCode: "300", periodEnd: "2026-09-30", simulated: false },
          now,
        ),
      ).toBeNull();
      // A refused deposit, or a code the service has not explained, is not the end:
      // the status can still move, and nothing is assumed about 301.
      for (const outcomeCode of ["501", "301"]) {
        expect(
          planNextStatusCheck(
            { reportingStatus: status, outcomeCode, periodEnd: "2026-09-30", simulated: false },
            now,
          ),
        ).not.toBeNull();
      }
    }
  });

  it("stops looking at settled, simulated and stale events", () => {
    const now = new Date("2026-12-01T10:00:00Z");
    for (const status of SETTLED_REPORTING_STATUSES) {
      for (const outcomeCode of [null, "500", "501", "300"]) {
        expect(
          planNextStatusCheck(
            { reportingStatus: status, outcomeCode, periodEnd: "2026-09-30", simulated: false },
            now,
          ),
        ).toBeNull();
      }
    }
    expect(
      planNextStatusCheck({ reportingStatus: "accepted", outcomeCode: null, periodEnd: null, simulated: true }, now),
    ).toBeNull();
    // Long after the cutoff an event that never became final is stale, whether it
    // never got filed or got filed and never heard back.
    expect(
      planNextStatusCheck({ reportingStatus: "accepted", outcomeCode: null, periodEnd: "2026-09-30", simulated: false }, now),
    ).toBeNull();
    expect(
      planNextStatusCheck({ reportingStatus: "filed", outcomeCode: "500", periodEnd: "2026-09-30", simulated: false }, now),
    ).toBeNull();
  });

  it("calls an event final only once filed with outcome 300, or rejected or superseded", () => {
    expect(isFrenchReportingFinal({ reportingStatus: "filed", outcomeCode: null })).toBe(false);
    expect(isFrenchReportingFinal({ reportingStatus: "filed", outcomeCode: "500" })).toBe(false);
    expect(isFrenchReportingFinal({ reportingStatus: "filed", outcomeCode: "501" })).toBe(false);
    expect(isFrenchReportingFinal({ reportingStatus: "filed", outcomeCode: "301" })).toBe(false);
    expect(isFrenchReportingFinal({ reportingStatus: "filed", outcomeCode: "300" })).toBe(true);
    expect(isFrenchReportingFinal({ reportingStatus: "filed_rectificative", outcomeCode: "300" })).toBe(true);
    expect(isFrenchReportingFinal({ reportingStatus: "rejected", outcomeCode: "501" })).toBe(true);
    expect(isFrenchReportingFinal({ reportingStatus: "rejected", outcomeCode: null })).toBe(true);
    expect(isFrenchReportingFinal({ reportingStatus: "superseded", outcomeCode: null })).toBe(true);
    // 300 on an event that is not filed is not final either: the status has to get there.
    expect(isFrenchReportingFinal({ reportingStatus: "accepted", outcomeCode: "300" })).toBe(false);

    expect(describeFrenchReportingOutcome(null)).toBe("none");
    expect(describeFrenchReportingOutcome("")).toBe("none");
    expect(describeFrenchReportingOutcome("500")).toBe("in_progress");
    expect(describeFrenchReportingOutcome("300")).toBe("final");
    expect(describeFrenchReportingOutcome("501")).toBe("needs_support");
    // Nothing is invented for a code the service has not explained.
    expect(describeFrenchReportingOutcome("301")).toBe("unrecognised");
  });

  it("selects the rows an earlier worker stopped at filed before they were final", () => {
    const stopped = {
      simulated: false,
      nextCheckAt: null,
      reportingStatus: "filed" as const,
      outcomeCode: null,
    };
    expect(wasStoppedBeforeFinal(stopped)).toBe(true);
    expect(wasStoppedBeforeFinal({ ...stopped, outcomeCode: "500" })).toBe(true);
    expect(wasStoppedBeforeFinal({ ...stopped, reportingStatus: "filed_rectificative" })).toBe(true);
    // Final rows, rows still being polled, simulated rows and rows that never got
    // filed are left alone: they were not stopped by that mistake.
    expect(wasStoppedBeforeFinal({ ...stopped, outcomeCode: "300" })).toBe(false);
    expect(wasStoppedBeforeFinal({ ...stopped, nextCheckAt: new Date() })).toBe(false);
    expect(wasStoppedBeforeFinal({ ...stopped, simulated: true })).toBe(false);
    expect(wasStoppedBeforeFinal({ ...stopped, reportingStatus: "accepted" })).toBe(false);
    expect(wasStoppedBeforeFinal({ ...stopped, reportingStatus: "rejected" })).toBe(false);
  });

  it("records what the partner reports and notices when the status moved", () => {
    const now = new Date("2026-10-03T10:00:00Z");
    const report = {
      flowId: "flow-1",
      declarantSiren: "303265045",
      clientOperationRef: "SALES-2026-09-01-GOODS",
      subFlux: "10.3",
      operation: "SUBMIT" as const,
      transmissionType: "IN",
      status: "TRANSMITTED" as const,
      reportingStatus: "filed" as const,
      receivedAt: "2026-09-01T18:00:00Z",
      operationDate: "2026-09-01",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      submissionId: "sub-9",
      outcomeCode: "OK",
      outcomeAt: "2026-10-02T09:00:00Z",
    };

    const { patch, changed, statusChanged, outcomeChanged } = applyStatusReport(
      { reportingStatus: "accepted", outcomeCode: null, simulated: false },
      { ...report, outcomeCode: null, outcomeAt: null },
      now,
    );
    expect(changed).toBe(true);
    expect(statusChanged).toBe(true);
    expect(outcomeChanged).toBe(false);
    expect(patch).toMatchObject({
      ledgerStatus: "TRANSMITTED",
      reportingStatus: "filed",
      periodEnd: "2026-09-30",
      submissionId: "sub-9",
      outcomeCode: null,
      checkAttempts: 0,
    });
    // Filed is not the end: the tax administration has not answered yet.
    expect(patch.nextCheckAt?.getTime()).toBe(now.getTime() + 6 * HOUR);
    expect(patch.receivedAt?.toISOString()).toBe("2026-09-01T18:00:00.000Z");

    const unchanged = applyStatusReport(
      { reportingStatus: "filed", outcomeCode: null, simulated: false },
      { ...report, outcomeCode: null, outcomeAt: null },
      now,
    );
    expect(unchanged.changed).toBe(false);
    expect(unchanged.unknownStatus).toBeNull();
  });

  it("notices the outcome moving while the status stays filed, and stops at 300", () => {
    const now = new Date("2026-10-03T10:00:00Z");
    const filed = {
      flowId: "flow-1",
      declarantSiren: "303265045",
      clientOperationRef: "SALES-2026-09-01-GOODS",
      subFlux: "10.3",
      operation: "SUBMIT",
      transmissionType: "IN",
      status: "TRANSMITTED",
      reportingStatus: "filed",
      receivedAt: "2026-09-01T18:00:00Z",
      operationDate: "2026-09-01",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      submissionId: "sub-9",
      outcomeCode: null,
      outcomeAt: null,
    };

    // Empty -> 500: the deposit is being processed. Worth telling, not yet final.
    const received = applyStatusReport(
      { reportingStatus: "filed", outcomeCode: null, simulated: false },
      { ...filed, outcomeCode: "500", outcomeAt: "2026-10-02T09:00:00Z" },
      now,
    );
    expect(received.changed).toBe(true);
    expect(received.statusChanged).toBe(false);
    expect(received.outcomeChanged).toBe(true);
    expect(received.patch.outcomeCode).toBe("500");
    expect(received.patch.nextCheckAt?.getTime()).toBe(now.getTime() + 6 * HOUR);

    // 500 -> 500: nothing new.
    const same = applyStatusReport(
      { reportingStatus: "filed", outcomeCode: "500", simulated: false },
      { ...filed, outcomeCode: "500", outcomeAt: "2026-10-02T09:00:00Z" },
      now,
    );
    expect(same.changed).toBe(false);
    expect(same.patch.nextCheckAt).not.toBeNull();

    // 500 -> 300: accepted, and now there is nothing left to learn.
    const accepted = applyStatusReport(
      { reportingStatus: "filed", outcomeCode: "500", simulated: false },
      { ...filed, outcomeCode: "300", outcomeAt: "2026-10-03T09:00:00Z" },
      now,
    );
    expect(accepted.changed).toBe(true);
    expect(accepted.outcomeChanged).toBe(true);
    expect(accepted.patch.outcomeCode).toBe("300");
    expect(accepted.patch.nextCheckAt).toBeNull();

    // 500 -> 501 while still filed: a refused deposit. Not final, keeps being looked at.
    const refused = applyStatusReport(
      { reportingStatus: "filed", outcomeCode: "500", simulated: false },
      { ...filed, outcomeCode: "501", outcomeAt: "2026-10-03T09:00:00Z" },
      now,
    );
    expect(refused.changed).toBe(true);
    expect(refused.patch.nextCheckAt).not.toBeNull();
  });

  it("keeps the status it knows when the service answers one it does not", () => {
    const now = new Date("2026-10-03T10:00:00Z");
    const report = {
      flowId: "flow-1",
      declarantSiren: "303265045",
      clientOperationRef: "SALES-2026-09-01-GOODS",
      subFlux: "10.3",
      operation: "SUBMIT",
      transmissionType: "IN",
      status: "AWAITING_SOMETHING_NEW",
      reportingStatus: "under_review_by_the_administration",
      receivedAt: "2026-09-01T18:00:00Z",
      operationDate: "2026-09-01",
      periodStart: "2026-09-01",
      // Long enough ago that the ordinary cadence would give up on the event.
      periodEnd: "2026-09-30",
      submissionId: "sub-9",
      outcomeCode: "300",
      outcomeAt: null,
    };

    const { patch, changed, unknownStatus } = applyStatusReport(
      { reportingStatus: "accepted", outcomeCode: "300", simulated: false },
      { ...report, periodEnd: "2026-06-30" },
      now,
    );

    // The event is not moved to a status this integration cannot reason about, and the
    // value is handed back so it can be reported rather than lost.
    expect(unknownStatus).toBe("under_review_by_the_administration");
    expect(changed).toBe(false);
    expect(patch.reportingStatus).toBe("accepted");
    // The raw ledger value is still kept as evidence of what was answered.
    expect(patch.ledgerStatus).toBe("AWAITING_SOMETHING_NEW");
    expect(patch.outcomeCode).toBe("300");
    // Polling continues on a fixed delay instead of the cadence of a status that is
    // not understood, which here would have stopped asking altogether.
    expect(patch.nextCheckAt).toEqual(new Date("2026-10-03T16:00:00Z"));

    // And it recovers on its own once a value it knows comes back; filed with 300 is
    // final, so there is nothing left to look at.
    const recovered = applyStatusReport(
      { reportingStatus: "accepted", outcomeCode: "300", simulated: false },
      { ...report, reportingStatus: "filed", status: "TRANSMITTED" },
      now,
    );
    expect(recovered.unknownStatus).toBeNull();
    expect(recovered.changed).toBe(true);
    expect(recovered.patch.reportingStatus).toBe("filed");
    expect(recovered.patch.nextCheckAt).toBeNull();
  });
});

describe("Operational alerts about one filing", () => {
  const submission = {
    id: "frs_1",
    environment: "PROD" as const,
    companyId: "comp_1",
    submissionId: "sub-9",
    outcomeCode: "501",
  };

  it("recognises events of the same filing and outcome as one condition", () => {
    const sibling = { ...submission, id: "frs_2" };

    expect(operationalAlertKey("rejected", submission)).toBe(
      operationalAlertKey("rejected", sibling),
    );
    // A later outcome on the same filing is something else to hear about.
    expect(operationalAlertKey("rejected", { ...sibling, outcomeCode: "500" })).not.toBe(
      operationalAlertKey("rejected", submission),
    );
    // As is the same filing in the other environment, or another company's filing.
    expect(operationalAlertKey("rejected", { ...sibling, environment: "TEST" })).not.toBe(
      operationalAlertKey("rejected", submission),
    );
    expect(operationalAlertKey("rejected", { ...sibling, companyId: "comp_2" })).not.toBe(
      operationalAlertKey("rejected", submission),
    );
    // And a different condition on the same filing is not folded in either.
    expect(operationalAlertKey("stale", submission)).not.toBe(
      operationalAlertKey("rejected", submission),
    );
  });

  it("keeps events apart while there is no filing to group them by", () => {
    const first = { ...submission, submissionId: null };
    const second = { ...first, id: "frs_2" };

    expect(operationalAlertKey("stale", first)).not.toBe(operationalAlertKey("stale", second));
  });

  it("reports a condition once per interval and lets it through again afterwards", () => {
    const suppressor = createAlertSuppressor({ intervalMs: 6 * HOUR });
    const start = new Date("2026-10-03T10:00:00Z");
    const key = operationalAlertKey("rejected", submission);

    expect(suppressor.shouldSend(key, start)).toBe(true);
    expect(suppressor.shouldSend(key, start)).toBe(false);
    expect(suppressor.shouldSend(key, new Date(start.getTime() + 5 * HOUR))).toBe(false);
    // Another condition is never suppressed by an unrelated one.
    expect(suppressor.shouldSend(operationalAlertKey("stale", submission), start)).toBe(true);
    // The condition can be reported again once the interval has passed, so a lasting
    // problem does not fall silent for good.
    expect(suppressor.shouldSend(key, new Date(start.getTime() + 7 * HOUR))).toBe(true);
  });

  it("does not grow without bound when many conditions are reported", () => {
    const suppressor = createAlertSuppressor({ intervalMs: 6 * HOUR, maxEntries: 3 });
    const start = new Date("2026-10-03T10:00:00Z");

    for (let index = 0; index < 50; index += 1) {
      expect(suppressor.shouldSend(`key-${index}`, start)).toBe(true);
    }
    // The oldest keys were dropped to stay within the bound, so they are reported
    // again rather than suppressed for ever.
    expect(suppressor.shouldSend("key-0", start)).toBe(true);
    expect(suppressor.shouldSend("key-49", start)).toBe(false);
  });
});
