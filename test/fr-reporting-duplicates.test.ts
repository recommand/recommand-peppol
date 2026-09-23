import { describe, expect, it } from "bun:test";
import {
  assessFrenchReportDuplicate,
  readStoredFrenchReport,
} from "../utils/parsing/fr-reporting/duplicates";
import { frenchB2BiReportSchema } from "../utils/parsing/b2bi-reporting/france";
import { frenchB2CReportSchema } from "../utils/parsing/b2c-reporting/france";

const invoiceRequest = {
  reference: "acme-inv-2026-000431",
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
};

const salesRequest = {
  reference: "SALES-2026-07-01-GOODS",
  type: "sales",
  date: "2026-07-01",
  category: "goods",
  taxExclusiveAmount: "10000.00",
  taxAmount: "2000.00",
  transactionCount: 42,
  vatBreakdown: [{ percentage: "20.00", taxableAmount: "10000.00", taxAmount: "2000.00" }],
};

const parseB2Bi = (report: unknown) => frenchB2BiReportSchema.parse(report);
const parseB2C = (report: unknown) => frenchB2CReportSchema.parse(report);

describe("Reports submitted under a reference that was already used", () => {
  it("recognises a retry of the very same request", () => {
    const filed = parseB2Bi(invoiceRequest);

    expect(assessFrenchReportDuplicate({ stored: filed, submitted: filed })).toEqual({
      kind: "retry",
      warning: null,
    });
  });

  it("recognises a retry written in a different but equivalent way", () => {
    // The stored report carries the defaults and the normalised amounts it was stored
    // with. A retry that leaves those out, spells amounts differently, or orders its
    // fields differently is the same request.
    const filed = parseB2Bi(invoiceRequest);
    const retry = parseB2Bi({
      vatBreakdown: [{ category: "K", taxAmount: 0, percentage: 0, taxableAmount: 10000 }],
      taxAmount: "0.00",
      taxExclusiveAmount: "10000.00",
      buyer: {
        vatNumber: "IT00987654321",
        country: "it",
        name: "Rossi Forniture S.r.l.",
        enterpriseNumber: null,
      },
      issueDate: "2026-01-15",
      billingMode: "B1",
      documentNumber: "INV-2026-000431",
      documentType: "invoice",
      currency: "EUR",
      action: "submit",
      type: "invoice",
      reference: "acme-inv-2026-000431",
    });

    expect(assessFrenchReportDuplicate({ stored: filed, submitted: retry }).kind).toBe("retry");
  });

  it("ignores stored fields that are not part of a report on either side", () => {
    // Both sides are read through the same schema, so anything outside it cannot make
    // two equal reports look different.
    const stored = { ...parseB2Bi(invoiceRequest), storedAt: "2026-01-15T10:00:00Z" };

    expect(
      assessFrenchReportDuplicate({ stored, submitted: parseB2Bi(invoiceRequest) }).kind,
    ).toBe("retry");
  });

  it("never presents a correction or cancellation as filed when the reference was a submission", () => {
    const filed = parseB2Bi(invoiceRequest);

    const cancellation = assessFrenchReportDuplicate({
      stored: filed,
      submitted: parseB2Bi({ ...invoiceRequest, action: "cancel" }),
    });
    expect(cancellation.kind).toBe("different_action");
    expect(cancellation.warning).toContain("Nothing was filed for this request");
    expect(cancellation.warning).toContain("cancellation");
    expect(cancellation.warning).toContain("new reference");
    // The earlier report was submitted; it must not be described as cancelled.
    expect(cancellation.warning).not.toContain("was cancelled");

    const correction = assessFrenchReportDuplicate({
      stored: filed,
      submitted: parseB2Bi({ ...invoiceRequest, action: "correct" }),
    });
    expect(correction.kind).toBe("different_action");
    expect(correction.warning).toContain("correction");
  });

  it("describes the request that was made, not the one on file", () => {
    // A plain submission under a reference that carried a correction is a report, not
    // a correction of its own.
    const assessment = assessFrenchReportDuplicate({
      stored: parseB2Bi({ ...invoiceRequest, action: "correct" }),
      submitted: parseB2Bi(invoiceRequest),
    });

    expect(assessment.kind).toBe("different_action");
    expect(assessment.warning).toContain("corrected");
    expect(assessment.warning).toContain("Send this report again under a new reference");
  });

  it("reports a reference reused for different figures", () => {
    const assessment = assessFrenchReportDuplicate({
      stored: parseB2C(salesRequest),
      submitted: parseB2C({ ...salesRequest, taxAmount: "2500.00" }),
    });

    expect(assessment.kind).toBe("different_content");
    expect(assessment.warning).toContain("different contents");
  });

  it("says the framework could not be compared with a report filed without one", () => {
    // What the framework would have been cannot be derived from a report that was
    // filed before it was asked for, so the retry is not confirmed as identical and
    // the framework is not assumed to match.
    const { billingMode: _billingMode, ...legacy } = invoiceRequest;

    const assessment = assessFrenchReportDuplicate({
      stored: { ...legacy, action: "submit", documentType: "invoice", currency: "EUR" },
      submitted: parseB2Bi(invoiceRequest),
    });

    expect(assessment.kind).toBe("unverified_billing_mode");
    expect(assessment.warning).toContain("without an invoicing framework");
    expect(assessment.warning).toContain("could not be compared");
  });

  it("still reports different figures on a report filed without a framework", () => {
    const { billingMode: _billingMode, ...legacy } = invoiceRequest;

    const assessment = assessFrenchReportDuplicate({
      stored: { ...legacy, action: "submit", documentType: "invoice", currency: "EUR" },
      submitted: parseB2Bi({ ...invoiceRequest, taxExclusiveAmount: "12000.00" }),
    });

    expect(assessment.kind).toBe("different_content");
  });

  it("claims nothing when the earlier report cannot be read", () => {
    for (const stored of [null, undefined, {}, { type: "invoice" }, "not a report"]) {
      const assessment = assessFrenchReportDuplicate({
        stored,
        submitted: parseB2Bi(invoiceRequest),
      });
      expect(assessment.kind).toBe("unknown_original");
      expect(assessment.warning).toContain("could not be read back");
    }
  });

  it("reads a stored report back as it was stored", () => {
    const { billingMode: _billingMode, ...legacy } = invoiceRequest;

    const stored = readStoredFrenchReport({
      ...legacy,
      action: "submit",
      documentType: "invoice",
      currency: "EUR",
    });
    expect(stored?.type).toBe("invoice");
    expect(stored && stored.type === "invoice" ? stored.billingMode : "set").toBeUndefined();

    expect(readStoredFrenchReport(parseB2C(salesRequest))?.type).toBe("sales");
    expect(readStoredFrenchReport({ type: "invoice" })).toBeNull();
  });
});
