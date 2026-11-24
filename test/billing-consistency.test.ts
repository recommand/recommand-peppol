import { describe, expect, it } from "bun:test";
import { checkBillingConsistency } from "@peppol/utils/parsing/invoice/consistency";
import { billingAiIntake } from "@peppol/utils/type-repository/document-types/billing-intake";
import { SAMPLE_TYPES, sampleDocument } from "./intake/fixtures";

// The arithmetic check of billing documents, and the base quantities that document
// intake corrects with it.

const invoice = sampleDocument("invoice").document;
const [line] = invoice.lines;

function withLine(changes: Record<string, unknown>) {
  return { ...invoice, lines: [{ ...line, ...changes }] };
}

function pointers(document: unknown) {
  return checkBillingConsistency(document as never).map((discrepancy) => discrepancy.pointer);
}

describe("checkBillingConsistency", () => {
  it.each(SAMPLE_TYPES)("finds nothing in a %s that our own encoder wrote", (type) => {
    expect(checkBillingConsistency(sampleDocument(type).document as never)).toEqual([]);
  });

  it("reports a line amount that is not quantity times price over base quantity", () => {
    const [discrepancy] = checkBillingConsistency(withLine({ quantity: "28820", netPriceAmount: "340.00", baseQuantity: null, netAmount: "100.00" }) as never);
    expect(discrepancy).toEqual({
      pointer: "/lines/0/netAmount",
      stated: "100.00",
      expected: "9798800.00",
      message: "The line amount is 100.00, but quantity 28820 × price 340.00 gives 9798800.00.",
    });
    expect(pointers(withLine({ quantity: "28820", netPriceAmount: "3.47", baseQuantity: "1000", netAmount: "100.00" }))).toEqual([]);
  });

  it("allows for a printed price that is rounded to the cent", () => {
    // 3 × 0.33 is 0.99, but a price of 0.3333 prints as 0.33.
    const document = withLine({ quantity: "3", netPriceAmount: "0.33", netAmount: "1.00" });
    expect(pointers(document)).not.toContain("/lines/0/netAmount");
    expect(pointers(withLine({ quantity: "3", netPriceAmount: "0.33", netAmount: "1.05" }))).toContain("/lines/0/netAmount");
  });

  it("reports totals that do not add up", () => {
    const document = {
      ...invoice,
      totals: { ...invoice.totals, linesAmount: "90.00", taxInclusiveAmount: "999.99" },
      vat: { ...invoice.vat, totalVatAmount: "20.00" },
    };
    expect(pointers(document)).toEqual(["/vat/totalVatAmount", "/totals/linesAmount", "/totals/taxExclusiveAmount", "/totals/taxInclusiveAmount"]);
  });

  it("reports a VAT breakdown whose category is not the category of the lines", () => {
    const subtotal = { ...invoice.vat.subtotals[0], category: "AE", percentage: "0", vatAmount: "0.00" };
    const document = withLine({ vat: { category: "K", percentage: "0" } });
    const discrepancies = checkBillingConsistency({ ...document, vat: { totalVatAmount: "0.00", subtotals: [subtotal] } } as never);
    expect(discrepancies.map((discrepancy) => discrepancy.pointer)).toEqual(
      expect.arrayContaining(["/vat/subtotals/0/category", "/vat/subtotals"]),
    );
  });

  it("allows a cent of VAT per line, which a document can round per line", () => {
    const lines = [1, 2, 3].map(() => ({ ...line, quantity: "1", netPriceAmount: "0.10", netAmount: "0.10" }));
    // 21% of each 0.10 rounds to 0.02, which adds up to 0.06; 21% of 0.30 is 0.06 too, so use 0.05.
    const vat = { totalVatAmount: "0.05", subtotals: [{ ...invoice.vat.subtotals[0], taxableAmount: "0.30", vatAmount: "0.05" }] };
    const totals = { ...invoice.totals, linesAmount: "0.30", taxExclusiveAmount: "0.30", taxInclusiveAmount: "0.35", payableAmount: "0.35" };
    expect(pointers({ ...invoice, lines, vat, totals })).toEqual([]);
    const off = { ...vat, totalVatAmount: "0.15", subtotals: [{ ...vat.subtotals[0], vatAmount: "0.15" }] };
    expect(pointers({ ...invoice, lines, vat: off, totals: { ...totals, taxInclusiveAmount: "0.45" } })).toEqual([
      "/vat/subtotals/0/vatAmount",
    ]);
  });

  it("checks nothing that the document does not state", () => {
    expect(checkBillingConsistency({ ...invoice, totals: null, vat: null } as never)).toEqual([]);
  });
});

describe("billing base quantities", () => {
  const reconcile = billingAiIntake.reconcile!;

  it("sets the one base quantity that makes a line add up, and reports it", () => {
    const { document, findings } = reconcile(withLine({ quantity: "200", baseQuantity: null }));
    expect((document as typeof invoice).lines[0].baseQuantity).toBe("100");
    expect(findings).toEqual([
      expect.objectContaining({ code: "corrected_value", severity: "info", pointer: "/content/lines/0/baseQuantity" }),
    ]);
  });

  it("removes a base quantity that the price is not for", () => {
    const { document } = reconcile(withLine({ baseQuantity: "1000" }));
    expect((document as typeof invoice).lines[0].baseQuantity).toBe("1");
  });

  it("leaves a line that adds up, or that no common base quantity explains", () => {
    expect(reconcile(invoice)).toEqual({ document: invoice, findings: [] });
    const unexplained = withLine({ quantity: "3" });
    expect(reconcile(unexplained)).toEqual({ document: unexplained, findings: [] });
  });
});
