import { describe, expect, it } from "bun:test";
import { toArratechB2cFlow } from "../data/at/b2c-reporting";
import { frenchB2cReportSchema } from "../utils/parsing/b2c-reporting/france";

const declarant = {
  siren: "123456789",
  name: "ACME SARL",
};

describe("French B2C reporting", () => {
  it("keeps the public French sales payload simple and maps provider codes internally", () => {
    const report = frenchB2cReportSchema.parse({
      reference: "SALES-2026-07-01-GOODS",
      type: "sales",
      date: "2026-07-01",
      category: "goods",
      taxExclusiveAmount: 10000,
      taxAmount: "2000",
      transactionCount: 42,
      vatBreakdown: [
        {
          percentage: 20,
          taxableAmount: "10000",
          taxAmount: "2000",
        },
      ],
    });

    expect(report.action).toBe("submit");
    expect(toArratechB2cFlow(report, declarant)).toEqual({
      subFlux: "10.3",
      clientOperationRef: "SALES-2026-07-01-GOODS",
      transmissionType: "IN",
      operation: "SUBMIT",
      declarant,
      payload: {
        date: "2026-07-01",
        currency: "EUR",
        categoryCode: "TLB1",
        taxExclusiveAmount: "10000.00",
        taxTotal: "2000.00",
        count: 42,
        subTotals: [
          {
            taxPercent: "20.00",
            taxableAmount: "10000.00",
            taxTotal: "2000.00",
          },
        ],
      },
    });
  });

  it("maps cash-basis payment corrections without exposing provider fields", () => {
    const report = frenchB2cReportSchema.parse({
      reference: "PAYMENTS-2026-07-01",
      action: "correct",
      type: "payments",
      date: "2026-07-01",
      vatBreakdown: [
        {
          percentage: "20.00",
          amount: "12000.00",
        },
      ],
    });

    expect(toArratechB2cFlow(report, declarant)).toEqual({
      subFlux: "10.4",
      clientOperationRef: "PAYMENTS-2026-07-01",
      transmissionType: "RE",
      operation: "SUBMIT",
      declarant,
      payload: {
        paymentDate: "2026-07-01",
        subTotals: [
          {
            taxPercent: "20.00",
            currencyCode: "EUR",
            amount: "12000.00",
          },
        ],
      },
    });
  });

  it("does not invent a provider transmission mode for cancellations", () => {
    const report = frenchB2cReportSchema.parse({
      reference: "SALES-2026-07-01-SERVICES",
      action: "cancel",
      type: "sales",
      date: "2026-07-01",
      category: "services",
      taxExclusiveAmount: "100.00",
      taxAmount: "20.00",
      transactionCount: 1,
      vatBreakdown: [
        {
          percentage: "20.00",
          taxableAmount: "100.00",
          taxAmount: "20.00",
        },
      ],
    });

    const providerPayload = toArratechB2cFlow(report, declarant);
    expect(providerPayload.operation).toBe("CANCEL");
    expect("transmissionType" in providerPayload).toBe(false);
  });

  it("rejects unsupported sales categories and empty VAT breakdowns", () => {
    const unsupportedCategory = frenchB2cReportSchema.safeParse({
      reference: "SALES-2026-07-01-OTHER",
      type: "sales",
      date: "2026-07-01",
      category: "mixed",
      taxExclusiveAmount: "100.00",
      taxAmount: "20.00",
      transactionCount: 1,
      vatBreakdown: [],
    });

    expect(unsupportedCategory.success).toBe(false);
  });
});
