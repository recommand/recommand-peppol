import { describe, expect, it, mock } from "bun:test";

// The repair is exercised against its own gateway; no database and no messages.
mock.module("@recommand/db", () => ({ db: {} }));
mock.module("@core/data/rules/events", () => ({ publishEvent: async () => {} }));

const { ensureFrenchReportingSubmissionRecord, recordFrenchReportingSubmission } = await import(
  "../data/fr-reporting-submissions"
);
const { frenchB2BiReportSchema } = await import("../utils/parsing/b2bi-reporting/france");
const { frenchB2CReportSchema } = await import("../utils/parsing/b2c-reporting/france");

type RecordedSubmission = Parameters<typeof recordFrenchReportingSubmission>[0];

/**
 * A stand-in for the two writes a filed report needs: the document, which succeeded,
 * and the record that follows it, which is the one that can fail.
 */
function gateway({ failFirstWrite = false }: { failFirstWrite?: boolean } = {}) {
  const rows: RecordedSubmission[] = [];
  const alerts: { title: string; message: string }[] = [];
  let writes = 0;

  return {
    rows,
    alerts,
    deps: {
      findByDocument: async (transmittedDocumentId: string) =>
        rows.find((row) => row.transmittedDocumentId === transmittedDocumentId) as never,
      record: async (values: RecordedSubmission) => {
        writes += 1;
        if (failFirstWrite && writes === 1) {
          throw new Error("connection reset while recording the submission");
        }
        rows.push(values);
      },
      alert: async (title: string, message: string) => {
        alerts.push({ title, message });
      },
    },
  };
}

const filedCorrection = frenchB2BiReportSchema.parse({
  reference: "acme-inv-2026-000431-c1",
  action: "correct",
  type: "invoice",
  documentNumber: "INV-2026-000431",
  billingMode: "B1",
  issueDate: "2026-01-15",
  buyer: { name: "Rossi Forniture S.r.l.", country: "IT", vatNumber: "IT00987654321" },
  taxExclusiveAmount: "10000.00",
  taxAmount: "0.00",
  vatBreakdown: [
    { percentage: "0.00", taxableAmount: "10000.00", taxAmount: "0.00", category: "K" },
  ],
});

const repairInput = {
  transmittedDocumentId: "doc_1",
  storedReport: filedCorrection,
  declarantId: "frd_1",
  teamId: "team_1",
  companyId: "comp_1",
  environment: "PROD" as const,
  flowId: "flow-1",
  simulated: false,
  ledgerStatus: "ACCEPTED",
  reportingStatus: "accepted" as const,
};

describe("A report that was filed without the record that follows it", () => {
  it("is repaired by the retry that lands on the existing document", async () => {
    const { rows, alerts, deps } = gateway({ failFirstWrite: true });

    // The report is filed and its document is written; the record that follows it is
    // not, because the write failed.
    await expect(
      deps.record({ ...repairInput, reference: "x", subFlux: "10.1" } as never),
    ).rejects.toThrow("connection reset");
    expect(rows).toHaveLength(0);

    // The customer retries under the same reference, which resolves to the same event
    // and lands on the document that already exists.
    const outcome = await ensureFrenchReportingSubmissionRecord(repairInput, deps);

    expect(outcome).toBe("repaired");
    expect(rows).toHaveLength(1);
    expect(alerts).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      transmittedDocumentId: "doc_1",
      flowId: "flow-1",
      // Read back from what was filed, so the record describes the earlier report.
      reference: "acme-inv-2026-000431-c1",
      subFlux: "10.1",
      operation: "SUBMIT",
      transmissionType: "RE",
      ledgerStatus: "ACCEPTED",
      reportingStatus: "accepted",
    });
  });

  it("describes the report on file, not the request that happens to be retrying", async () => {
    const { rows, deps } = gateway();

    // A reference reused for something else must not rewrite what was filed under it.
    await ensureFrenchReportingSubmissionRecord(
      {
        ...repairInput,
        storedReport: frenchB2CReportSchema.parse({
          reference: "SALES-2026-07-01-GOODS",
          type: "sales",
          date: "2026-07-01",
          category: "goods",
          taxExclusiveAmount: "100.00",
          taxAmount: "20.00",
          transactionCount: 1,
          vatBreakdown: [
            { percentage: "20.00", taxableAmount: "100.00", taxAmount: "20.00" },
          ],
        }),
      },
      deps,
    );

    expect(rows[0]).toMatchObject({
      reference: "SALES-2026-07-01-GOODS",
      subFlux: "10.3",
      operation: "SUBMIT",
      transmissionType: "IN",
    });
  });

  it("reads a report filed before the invoicing framework and does not invent one", async () => {
    const { rows, alerts, deps } = gateway();
    const { billingMode: _billingMode, ...legacy } = filedCorrection as Record<string, unknown>;

    const outcome = await ensureFrenchReportingSubmissionRecord(
      { ...repairInput, storedReport: legacy },
      deps,
    );

    expect(outcome).toBe("repaired");
    expect(alerts).toHaveLength(0);
    expect(rows[0]).toMatchObject({ reference: "acme-inv-2026-000431-c1", subFlux: "10.1" });
    expect(rows[0]).not.toHaveProperty("billingMode");
  });

  it("leaves an existing record alone, so a genuine retry writes nothing twice", async () => {
    const { rows, deps } = gateway();

    expect(await ensureFrenchReportingSubmissionRecord(repairInput, deps)).toBe("repaired");
    expect(await ensureFrenchReportingSubmissionRecord(repairInput, deps)).toBe("present");
    expect(await ensureFrenchReportingSubmissionRecord(repairInput, deps)).toBe("present");
    expect(rows).toHaveLength(1);
  });

  it("tells support when the report on file cannot be read, and invents nothing", async () => {
    const { rows, alerts, deps } = gateway();

    const outcome = await ensureFrenchReportingSubmissionRecord(
      { ...repairInput, storedReport: null },
      deps,
    );

    expect(outcome).toBe("unrecoverable");
    expect(rows).toHaveLength(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toBe("French Reporting Record Missing");
    expect(alerts[0]!.message).toContain("flow-1");
  });
});
