import { describe, expect, it } from "bun:test";
import {
  buildFrenchDeclarant,
  toArratechB2cFlow,
} from "../data/at/b2c-reporting";
import {
  frenchB2cReportSchema,
  getFrenchB2cReportDocumentTypeInfo,
} from "../utils/parsing/b2c-reporting/france";
import { sendDocumentSchema } from "../utils/parsing/send-document";
import {
  DOCUMENT_TYPE_PRESETS,
  REPORTING_DOCUMENT_TYPES,
} from "../utils/document-types";
import { getDocumentXmlHandlersByDocTypeId } from "../utils/parsing/document-handlers";

const declarant = {
  siren: "123456789",
  name: "ACME SARL",
};

const salesReport = {
  reference: "SALES-2026-07-01-GOODS",
  type: "sales",
  date: "2026-07-01",
  category: "goods",
  taxExclusiveAmount: "10000.00",
  taxAmount: "2000.00",
  transactionCount: 42,
  vatBreakdown: [
    {
      percentage: "20.00",
      taxableAmount: "10000.00",
      taxAmount: "2000.00",
    },
  ],
} as const;

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

  it("is not accepted by the send-document endpoint", () => {
    // Reports have their own endpoint; /send only takes documents that are
    // transmitted to a recipient.
    for (const documentType of REPORTING_DOCUMENT_TYPES) {
      expect(
        sendDocumentSchema.safeParse({
          recipient: null,
          documentType,
          document: salesReport,
        }).success
      ).toBe(false);
    }
  });

  it("files sales and payment reports as distinct document types", () => {
    const sales = getFrenchB2cReportDocumentTypeInfo("sales");
    const payments = getFrenchB2cReportDocumentTypeInfo("payments");

    expect(sales.type).toBe("frenchB2cSalesReport");
    expect(payments.type).toBe("frenchB2cPaymentReport");
    expect(sales.docTypeId).not.toBe(payments.docTypeId);
  });

  it("keeps the report document types out of the Peppol sending vocabularies", () => {
    // A report has no XML representation and must never be advertised as an SMP
    // receiving capability, so it belongs to neither registry.
    for (const reportingType of REPORTING_DOCUMENT_TYPES) {
      expect(
        DOCUMENT_TYPE_PRESETS.some((preset) => preset.type === reportingType)
      ).toBe(false);
    }
    for (const reportType of ["sales", "payments"] as const) {
      expect(
        getDocumentXmlHandlersByDocTypeId(
          getFrenchB2cReportDocumentTypeInfo(reportType).docTypeId
        )
      ).toHaveLength(0);
    }
  });

  it("derives the declarant SIREN from the enterprise number only", () => {
    expect(
      buildFrenchDeclarant({
        name: "ACME SARL",
        enterpriseNumber: "123 456 789",
      })
    ).toEqual(declarant);

    // A SIREN is exactly nine digits; anything else cannot stand in for one.
    for (const enterpriseNumber of [null, "12345678", "1234567890", "FR123456789"]) {
      expect(
        buildFrenchDeclarant({ name: "ACME SARL", enterpriseNumber })
      ).toBeNull();
    }
  });
});
