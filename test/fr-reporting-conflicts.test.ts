import { describe, expect, it } from "bun:test";
import {
  describeFrenchReportingConflict,
  FRENCH_REPORTING_PERIOD_ASSEMBLED_CODE,
  FrenchReportingSubmissionError,
  isFrenchReportingPeriodAssembled,
} from "../data/at/fr-reporting";

describe("A report the reporting service refuses as conflicting", () => {
  it("explains a correction that came after the period was assembled", () => {
    const error = new FrenchReportingSubmissionError(
      "Period already assembled",
      "conflict",
      409,
      FRENCH_REPORTING_PERIOD_ASSEMBLED_CODE,
    );

    expect(isFrenchReportingPeriodAssembled(error)).toBe(true);
    const { periodAssembled, message } = describeFrenchReportingConflict(error);
    expect(periodAssembled).toBe(true);
    // The service's own diagnostics stay in the message, because support asks for them.
    expect(message).toContain("Period already assembled");
    expect(message).toContain("AT-2707");
    expect(message).toContain("Nothing was changed");
    // What can still be done, and what goes through support with which handle.
    expect(message).toContain("can still be submitted");
    expect(message).toContain("contact support with the reference");
    expect(message).toContain("period");
  });

  it("keeps other conflicts generic and keeps their diagnostics", () => {
    const error = new FrenchReportingSubmissionError(
      "Unknown invoice INV-1",
      "conflict",
      409,
      "AT-2701",
    );

    expect(isFrenchReportingPeriodAssembled(error)).toBe(false);
    const { periodAssembled, message } = describeFrenchReportingConflict(error);
    expect(periodAssembled).toBe(false);
    expect(message).toBe("The report conflicts with what was filed before: Unknown invoice INV-1 (AT-2701)");
  });

  it("does not read the period code into an error of another kind", () => {
    const error = new FrenchReportingSubmissionError(
      "Bad request",
      "rejected",
      400,
      FRENCH_REPORTING_PERIOD_ASSEMBLED_CODE,
    );
    expect(isFrenchReportingPeriodAssembled(error)).toBe(false);
  });
});
