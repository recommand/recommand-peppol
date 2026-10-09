import { beforeAll, describe, expect, it, mock } from "bun:test";

let classifyFailures: typeof import("../data/integrations/client").classifyFailures;

beforeAll(async () => {
  // The classification touches no database; the module only imports it.
  mock.module("@recommand/db", () => ({ db: {} }));
  ({ classifyFailures } = await import("../data/integrations/client"));
});

// Which integration failures reach the team at once, and which only count towards a
// failed scheduled run.

const invoiceFailure = { task: "process_invoice", message: "Missing VAT number", context: "52672154" };
const companyFailure = { task: "fetch_company", message: "Failed to fetch company: 401 Unauthorized" };

describe("integration failure classification", () => {
  it("reports item failures of a scheduled run at once and counts the rest as a failed run", () => {
    expect(classifyFailures("integration.cron.short", [invoiceFailure, companyFailure], false))
      .toEqual({ immediate: [invoiceFailure], run: [companyFailure], scheduled: true });
  });

  it("treats an error response to a scheduled run as a failed run, whatever its context", () => {
    const error = { task: "HARVEST_API_ERROR", message: "Failed to fetch invoices: 502", context: "x" };
    expect(classifyFailures("integration.cron.medium", [error], true))
      .toEqual({ immediate: [], run: [error], scheduled: true });
  });

  it("reports every failure of other events at once", () => {
    for (const event of ["integration.setup", "integration.task.retry", "document.received"] as const) {
      expect(classifyFailures(event, [companyFailure], true)).toEqual({ immediate: [companyFailure], run: [], scheduled: false });
    }
  });
});
