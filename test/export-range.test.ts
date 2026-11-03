import { describe, expect, it } from "bun:test";
import { isExportRangeWithinLimit } from "../utils/export-range";

describe("isExportRangeWithinLimit", () => {
  it("accepts a 31-day month that spans the end of daylight saving time", () => {
    const from = new Date("2026-10-01T00:00:00+02:00");
    const to = new Date("2026-11-01T00:00:00+01:00");
    expect(isExportRangeWithinLimit(from, to)).toBe(true);
  });

  it("accepts a 31-day month without a time change", () => {
    const from = new Date("2026-01-01T00:00:00+01:00");
    const to = new Date("2026-02-01T00:00:00+01:00");
    expect(isExportRangeWithinLimit(from, to)).toBe(true);
  });

  it("rejects a range longer than 31 days", () => {
    const from = new Date("2026-01-01T00:00:00+01:00");
    const to = new Date("2026-02-02T00:00:00+01:00");
    expect(isExportRangeWithinLimit(from, to)).toBe(false);
  });
});
