import { describe, expect, it } from "bun:test";
import {
  ambiguousDateFindings,
  discrepancies,
  extractionIssues,
  minimumEvidenceIssues,
  normalizeExtraction,
} from "@peppol/utils/pipelines/intake/checks";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { sampleDocument } from "./intake/fixtures";

// The checks of an extracted document that its schema cannot express: unit codes, VAT
// categories against their rates, numeric dates that can be read two ways, and the
// amounts and quantities of orders and despatch advices.

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

describe("order", () => {
  const orderType = getDocumentType("order")!;
  const order = sampleDocument("order").document;
  const pointers = (document: unknown) => discrepancies(orderType, document).map((discrepancy) => discrepancy.pointer);
  const unpriced = {
    ...order,
    lines: order.lines.map(({ netPriceAmount: _price, netAmount: _amount, vat: _vat, ...line }: Record<string, unknown>) => line),
    totals: null,
    vat: null,
  };

  it("finds nothing in an order that our own encoder wrote, nor in an order without prices", () => {
    expect(discrepancies(orderType, order)).toEqual([]);
    expect(discrepancies(orderType, unpriced)).toEqual([]);
    expect(extractionIssues(orderType, unpriced)).toEqual([]);
  });

  it("checks only the lines that have a price", () => {
    const mixed = { ...order, lines: [unpriced.lines[0], { ...order.lines[1], netAmount: "700.00" }], totals: null, vat: null };
    expect(pointers(mixed)).toEqual(["/lines/1/netAmount"]);
  });

  it("finds totals that do not add up and a VAT total that the lines do not give", () => {
    expect(pointers({ ...order, totals: { ...order.totals, taxExclusiveAmount: "1500.00" } })).toEqual([
      "/totals/taxExclusiveAmount",
      "/totals/taxInclusiveAmount",
    ]);
    const [discrepancy] = discrepancies(orderType, { ...order, vat: { totalVatAmount: "99.00" }, totals: { ...order.totals, taxInclusiveAmount: "1607.00" } });
    expect(discrepancy).toEqual({
      pointer: "/vat/totalVatAmount",
      stated: "99.00",
      expected: "90.48",
      message: "The total VAT is 99.00, but the VAT categories and rates of the lines, discounts and surcharges give 90.48.",
    });
  });

  it("requires no payable amount, as a billing document does", () => {
    expect(minimumEvidenceIssues(orderType, unpriced)).toEqual([]);
    const { totals: _totals, ...withoutTotals } = invoice;
    expect(minimumEvidenceIssues(invoiceType, withoutTotals).map((issue) => issue.code)).toEqual(["missing_payable_amount"]);
  });

  it("reports a VAT category with a rate it cannot have, a total that is not printed, and a negative quantity", () => {
    const document = {
      ...order,
      lines: [{ ...order.lines[0], vat: { category: "S", percentage: "0.00" } }, { ...order.lines[1], quantity: "-12" }],
    };
    expect(extractionIssues(orderType, document, "Total 1.598,48").map((issue) => issue.pointer)).toEqual([
      "/lines/0/vat/category",
      "/lines/1/quantity",
    ]);
    expect(extractionIssues(orderType, order, "Total 99,00").map((issue) => issue.code)).toEqual(["unprinted_total"]);
    // An order without totals has no total to find in the text.
    expect(extractionIssues(orderType, unpriced, "Total 99,00")).toEqual([]);
  });

  it("leaves out the optional objects that state nothing, but keeps a required party", () => {
    const document = {
      ...order,
      buyer: { name: "", street: "" },
      delivery: { requestedPeriod: { startDate: null, endDate: "" }, location: { country: "" } },
      deliveryTerms: { code: null, specialTerms: "" },
      lines: [{ ...order.lines[0], vat: {}, standardId: { scheme: "", identifier: "" } }],
    };
    const normalized = normalizeExtraction(orderType, document) as Record<string, any>;
    expect(normalized.buyer).toEqual({ name: "", street: "" });
    expect(normalized.delivery).toBeNull();
    expect(normalized.deliveryTerms).toBeNull();
    expect(normalized.lines[0]).toMatchObject({ vat: null, standardId: null });
  });
});

describe("despatch advice", () => {
  const despatchAdviceType = getDocumentType("despatchAdvice")!;
  const despatchAdvice = sampleDocument("despatchAdvice").document;

  it("finds nothing in a despatch advice that our own encoder wrote, and has no consistency check", () => {
    expect(extractionIssues(despatchAdviceType, despatchAdvice)).toEqual([]);
    expect(despatchAdviceType.checkConsistency).toBeUndefined();
    expect(minimumEvidenceIssues(despatchAdviceType, despatchAdvice)).toEqual([]);
  });

  it("reports a negative delivered or outstanding quantity", () => {
    const document = { ...despatchAdvice, lines: [{ ...despatchAdvice.lines[0], quantity: "-30", outstandingQuantity: "-10" }] };
    expect(extractionIssues(despatchAdviceType, document)).toEqual([
      { code: "negative_quantity", message: "The quantity -30 is negative. Write the quantity as a positive number.", pointer: "/lines/0/quantity" },
      {
        code: "negative_quantity",
        message: "The outstandingQuantity -10 is negative. Write the quantity as a positive number.",
        pointer: "/lines/0/outstandingQuantity",
      },
    ]);
  });

  it("leaves out a referenced party and a measure that state nothing, and writes a printed unit as its code", () => {
    const document = {
      ...despatchAdvice,
      buyer: { name: "", identifier: { identifier: "", scheme: null } },
      shipment: { ...despatchAdvice.shipment, grossWeight: { value: "1200", unitCode: "kg" }, grossVolume: { value: "", unitCode: "" } },
    };
    const normalized = normalizeExtraction(despatchAdviceType, document) as Record<string, any>;
    expect(normalized.buyer).toBeNull();
    expect(normalized.shipment.grossWeight).toEqual({ value: "1200", unitCode: "KGM" });
    expect(normalized.shipment.grossVolume).toBeNull();
  });
});
