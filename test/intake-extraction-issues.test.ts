import { describe, expect, it } from "bun:test";
import { ambiguousDateFindings, extractionIssues, normalizeExtraction } from "@peppol/utils/pipelines/intake/checks";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { sampleDocument } from "./intake/fixtures";

// The checks of an extracted document that its schema cannot express: unit codes, VAT
// categories against their rates, and numeric dates that can be read two ways.

const invoiceType = getDocumentType("invoice")!;
const invoice = sampleDocument("invoice").document;

describe("extractionIssues", () => {
  it("accepts the sample invoice", () => {
    expect(extractionIssues(invoiceType, invoice)).toEqual([]);
  });

  it("reports a unit that is not a unit code", () => {
    const document = { ...invoice, lines: [{ ...invoice.lines[0], unitCode: "PCSX" }] };
    expect(extractionIssues(invoiceType, document)).toEqual([
      { code: "invalid_unit_code", message: "PCSX is not a UN/ECE Recommendation 20 unit code.", pointer: "/lines/0/unitCode" },
    ]);
  });

  it("reports VAT category S at 0% and a zero-rate category above 0%", () => {
    const document = {
      ...invoice,
      lines: [{ ...invoice.lines[0], vat: { category: "S", percentage: "0.00" } }],
      vat: { ...invoice.vat, subtotals: [{ ...invoice.vat.subtotals[0], category: "E", percentage: "21.00" }] },
    };
    expect(extractionIssues(invoiceType, document).map((issue) => issue.pointer)).toEqual([
      "/lines/0/vat/category",
      "/vat/subtotals/0/category",
    ]);
  });
});

describe("billing totals", () => {
  const codes = (document: unknown, text?: string, type = invoiceType) =>
    extractionIssues(type, document, text).map((issue) => issue.code);

  it("reports an amount to pay that is not the total minus the paid amount", () => {
    expect(codes({ ...invoice, totals: { ...invoice.totals, payableAmount: "0.00", paidAmount: null } })).toEqual([
      "payable_amount",
    ]);
    expect(codes({ ...invoice, totals: { ...invoice.totals, payableAmount: "0.00", paidAmount: "121.00" } })).toEqual([]);
  });

  it("reports a total with VAT that the text layer does not print", () => {
    expect(codes(invoice, "Total to pay: EUR 121,00")).toEqual([]);
    expect(codes(invoice, "Totaal € 121")).toEqual([]);
    expect(codes(invoice, "Subtotal 1121.00, total 99.00")).toEqual(["unprinted_total"]);
    expect(codes(invoice, undefined)).toEqual([]);
  });

  it("reads thousands separators", () => {
    const large = { ...invoice, totals: { ...invoice.totals, taxInclusiveAmount: "1199.00", payableAmount: "1199.00" } };
    expect(codes(large, "Totaal € 1.199,00")).toEqual([]);
    expect(codes(large, "Total $1,199.00")).toEqual([]);
  });

  it("reports a credit note with negative totals", () => {
    const creditNoteType = getDocumentType("creditNote")!;
    const negative = { ...invoice, totals: { ...invoice.totals, taxInclusiveAmount: "-121.00", payableAmount: "-121.00" } };
    expect(codes(negative, undefined, creditNoteType)).toEqual(["negative_credit_note"]);
    expect(codes(invoice, undefined, creditNoteType)).toEqual([]);
  });
});

describe("unit normalization", () => {
  it("writes a printed abbreviation as its unit code", () => {
    const document = { ...invoice, lines: [{ ...invoice.lines[0], unitCode: "TB" }, { ...invoice.lines[0], unitCode: "%" }] };
    const normalized = normalizeExtraction(invoiceType, document) as typeof invoice;
    expect(normalized.lines.map((line: { unitCode: string }) => line.unitCode)).toEqual(["E35", "P1"]);
  });
});

describe("ambiguousDateFindings", () => {
  it("reports a numeric date whose day and month can be swapped", () => {
    const findings = ambiguousDateFindings({ issueDate: "2026-02-03" }, "Invoice date: 03/02/2026", []);
    expect(findings).toEqual([
      {
        code: "ambiguous_date",
        severity: "warning",
        scope: "extraction",
        message: "The document prints the date as 03/02/2026, which can also be read as 2026-03-02. It was read as 2026-02-03.",
        pointer: "/content/issueDate",
      },
    ]);
  });

  it("reports a date read month first", () => {
    const findings = ambiguousDateFindings({ issueDate: "2026-03-02" }, "Invoice date: 03/02/2026", []);
    expect(findings[0].message).toContain("can also be read as 2026-02-03");
  });

  it("trusts the order that another date of the text shows", () => {
    expect(ambiguousDateFindings({ issueDate: "2026-02-03" }, "Date 03/02/2026, due 17/02/2026", [])).toEqual([]);
  });

  it("skips a date that cannot be swapped, a date printed in words, and a scanned PDF", () => {
    expect(ambiguousDateFindings({ issueDate: "2026-02-15" }, "15/02/2026", [])).toEqual([]);
    expect(ambiguousDateFindings({ issueDate: "2026-02-03" }, "3 February 2026", [])).toEqual([]);
    expect(ambiguousDateFindings({ issueDate: "2026-02-03" }, undefined, [])).toEqual([]);
  });

  it("skips a date that the model already reported as uncertain", () => {
    const reported = [
      { code: "uncertain_value", severity: "warning" as const, scope: "extraction" as const, message: "", pointer: "/content/issueDate" },
    ];
    expect(ambiguousDateFindings({ issueDate: "2026-02-03" }, "03/02/2026", reported)).toEqual([]);
  });
});
