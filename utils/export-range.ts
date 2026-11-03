const HOUR_MS = 60 * 60 * 1000;

// A month of 31 days that spans the end of daylight saving time is one hour
// longer than 31 * 24 hours, so allow that hour on top of the 31 days.
export const MAX_EXPORT_RANGE_MS = 31 * 24 * HOUR_MS + HOUR_MS;

export function isExportRangeWithinLimit(from: Date, to: Date): boolean {
    return to.getTime() - from.getTime() <= MAX_EXPORT_RANGE_MS;
}
