import { describe, expect, it } from "bun:test";
import {
  assessFrenchPaymentInstalment,
  type EarlierFrenchPaymentReport,
} from "../utils/parsing/fr-reporting/instalments";

const onFile: EarlierFrenchPaymentReport = {
  documentId: "doc_1",
  reference: "acme-pay-000431-1",
  action: "submit",
  date: "2026-02-10",
  reportingStatus: "accepted",
};

const submitted = {
  reference: "acme-pay-000431-2",
  action: "submit" as const,
  invoiceNumber: "INV-2026-000431",
  date: "2026-03-10",
};

describe("A payment report next to the payment reports on file for its invoice", () => {
  it("goes through when it is the first payment report on the invoice", () => {
    expect(assessFrenchPaymentInstalment({ earlier: [], submitted })).toEqual({
      kind: "first",
      refusal: null,
    });
  });

  it("refuses a plain submit that would silently replace the payment on file", () => {
    const assessment = assessFrenchPaymentInstalment({ earlier: [onFile], submitted });

    expect(assessment.kind).toBe("second_instalment");
    // The customer is told what would have happened and what the choices are, and
    // is not told what the replacing report should add up to.
    expect(assessment.refusal).toContain("INV-2026-000431");
    expect(assessment.refusal).toContain(`"${onFile.reference}"`);
    expect(assessment.refusal).toContain("replaces the earlier one");
    expect(assessment.refusal).toContain("Nothing was filed");
    expect(assessment.refusal).toContain('action: "correct"');
    expect(assessment.refusal).toContain('action: "cancel"');
    expect(assessment.refusal).not.toMatch(/cumulative|total received/i);
  });

  it("treats a payment report never recorded to be followed as still on file", () => {
    const assessment = assessFrenchPaymentInstalment({
      earlier: [{ ...onFile, reportingStatus: null }],
      submitted,
    });
    expect(assessment.kind).toBe("second_instalment");
  });

  it("lets a retry of the same reference through to the idempotent path", () => {
    const assessment = assessFrenchPaymentInstalment({
      earlier: [onFile],
      submitted: { ...submitted, reference: onFile.reference },
    });
    expect(assessment).toEqual({ kind: "retry", refusal: null });
  });

  it("lets an explicit replacement and a cancellation through", () => {
    expect(
      assessFrenchPaymentInstalment({ earlier: [onFile], submitted: { ...submitted, action: "correct" } }),
    ).toEqual({ kind: "replacement", refusal: null });
    expect(
      assessFrenchPaymentInstalment({ earlier: [onFile], submitted: { ...submitted, action: "cancel" } }),
    ).toEqual({ kind: "cancellation", refusal: null });
  });

  it("does not count a cancelled or superseded payment as still on file", () => {
    const cancellation: EarlierFrenchPaymentReport = {
      ...onFile,
      documentId: "doc_2",
      reference: "acme-pay-000431-cancel",
      action: "cancel",
    };
    expect(
      assessFrenchPaymentInstalment({
        earlier: [cancellation, { ...onFile, reportingStatus: "superseded" }],
        submitted,
      }),
    ).toEqual({ kind: "first", refusal: null });
    // The cancellation counts from the moment the service accepted it, before the
    // status worker has polled the original back as superseded: that poll can be a
    // day away, and a customer who cancelled must be able to start over now.
    expect(
      assessFrenchPaymentInstalment({
        earlier: [cancellation, { ...onFile, reportingStatus: "accepted" }],
        submitted,
      }),
    ).toEqual({ kind: "first", refusal: null });
    // A report filed after the cancellation is on file again, whatever came before.
    const afterCancel: EarlierFrenchPaymentReport = {
      ...onFile,
      documentId: "doc_4",
      reference: "acme-pay-000431-2",
    };
    expect(
      assessFrenchPaymentInstalment({
        earlier: [afterCancel, cancellation, onFile],
        submitted: { ...submitted, reference: "acme-pay-000431-3" },
      }).kind,
    ).toBe("second_instalment");

    // But a correction that replaced the original is itself the report on file.
    const replacement: EarlierFrenchPaymentReport = {
      ...onFile,
      documentId: "doc_3",
      reference: "acme-pay-000431-c1",
      action: "correct",
    };
    expect(
      assessFrenchPaymentInstalment({
        earlier: [replacement, { ...onFile, reportingStatus: "superseded" }],
        submitted,
      }).kind,
    ).toBe("second_instalment");
  });
});
