import { describe, expect, it } from "bun:test";
import {
  buildFranceB2CReportTemplateData,
  isRenderableDocumentType,
} from "../utils/document-renderer";
import type { PublicTransmittedDocument } from "../data/transmitted-documents";
import { extractDocumentDetails } from "../data/email/document-details";
import type { ParsedDocument } from "../utils/document-filename";
import { FRANCE_B2C_REPORT_TEMPLATE } from "../templates/france-b2c-report";
import { REPORTING_DOCUMENT_TYPES } from "../utils/document-types";
import {
  frenchB2CReportSchema,
  getFrenchB2CReportDocumentTypeInfo,
} from "../utils/parsing/b2c-reporting/france";

function documentFor(report: unknown): PublicTransmittedDocument {
  const parsed = frenchB2CReportSchema.parse(report);
  return {
    id: "doc_report",
    type: getFrenchB2CReportDocumentTypeInfo(parsed.type).type,
    parsed,
  } as unknown as PublicTransmittedDocument;
}

const salesDocument = documentFor({
  reference: "SALES-2026-07-01-GOODS",
  type: "sales",
  date: "2026-07-01",
  category: "goods",
  currency: "USD",
  taxExclusiveAmount: "10000.00",
  taxAmount: "2000.00",
  transactionCount: 42,
  vatBreakdown: [
    { percentage: "20.00", taxableAmount: "8000.00", taxAmount: "1600.00" },
    { percentage: "5.50", taxableAmount: "2000.00", taxAmount: "400.00" },
  ],
});

const paymentsDocument = documentFor({
  reference: "PAYMENTS-2026-07-01",
  action: "correct",
  type: "payments",
  date: "2026-07-01",
  vatBreakdown: [{ percentage: "20.00", amount: "12000.00" }],
});

describe("French B2C report rendering", () => {
  it("renders both report types like any other document", () => {
    for (const reportingType of REPORTING_DOCUMENT_TYPES) {
      expect(isRenderableDocumentType(reportingType)).toBe(true);
    }
  });

  it("uses the document type the report was filed as", () => {
    expect(salesDocument.type).toBe("frenchB2CSalesReport");
    expect(paymentsDocument.type).toBe("frenchB2CPaymentReport");
  });

  it("lays out a sales report with its totals and VAT breakdown", () => {
    const data = buildFranceB2CReportTemplateData(salesDocument);

    expect(data).toMatchObject({
      reference: "SALES-2026-07-01-GOODS",
      reportTypeLabel: "Daily sales",
      dateLabel: "Sales date",
      date: "2026-07-01",
      actionLabel: "Submission",
      isSubmission: true,
      isSales: true,
      isPayments: false,
      categoryLabel: "Taxable goods",
      transactionCount: 42,
      taxExclusiveAmount: "10000.00",
      taxAmount: "2000.00",
      currency: "USD",
    });
    // Sales amounts carry the report currency; VAT is always EUR, which the
    // template states next to the amount rather than per row.
    expect(data.salesVatBreakdown).toEqual([
      {
        percentage: "20.00",
        taxableAmount: "8000.00",
        taxAmount: "1600.00",
        currency: "USD",
      },
      {
        percentage: "5.50",
        taxableAmount: "2000.00",
        taxAmount: "400.00",
        currency: "USD",
      },
    ]);
    expect(data.paymentVatBreakdown).toEqual([]);
  });

  it("lays out a payment report as received amounts in EUR", () => {
    const data = buildFranceB2CReportTemplateData(paymentsDocument);

    expect(data).toMatchObject({
      reference: "PAYMENTS-2026-07-01",
      reportTypeLabel: "Daily payments received",
      dateLabel: "Payment date",
      actionLabel: "Correction",
      isCorrection: true,
      isSales: false,
      isPayments: true,
      currency: "EUR",
    });
    // A payment report has no category, count, or totals to show.
    expect(data.categoryLabel).toBeUndefined();
    expect(data.transactionCount).toBeUndefined();
    expect(data.taxExclusiveAmount).toBeUndefined();
    expect(data.salesVatBreakdown).toEqual([]);
    expect(data.paymentVatBreakdown).toEqual([
      { percentage: "20.00", amount: "12000.00" },
    ]);
  });

  it("marks a cancellation so the preview cannot be mistaken for a filing", () => {
    const data = buildFranceB2CReportTemplateData(
      documentFor({
        reference: "SALES-2026-07-01-CANCEL",
        action: "cancel",
        type: "sales",
        date: "2026-07-01",
        category: "services",
        taxExclusiveAmount: "100.00",
        taxAmount: "20.00",
        transactionCount: 1,
        vatBreakdown: [
          { percentage: "20.00", taxableAmount: "100.00", taxAmount: "20.00" },
        ],
      })
    );

    expect(data.actionLabel).toBe("Cancellation");
    expect(data.isCancellation).toBe(true);
    expect(data.isSubmission).toBe(false);
    expect(data.categoryLabel).toBe("Taxable services");
  });

  it("only uses placeholders the template data provides", () => {
    // The template is an untyped string, so a typo would silently render a blank.
    const data = buildFranceB2CReportTemplateData(salesDocument);
    const available = new Set([
      ...Object.keys(data),
      ...Object.keys(data.salesVatBreakdown[0] ?? {}),
      ...Object.keys(
        buildFranceB2CReportTemplateData(paymentsDocument)
          .paymentVatBreakdown[0] ?? {}
      ),
    ]);

    const opened: string[] = [];
    for (const [, marker, name] of FRANCE_B2C_REPORT_TEMPLATE.matchAll(
      /\{\{([#/]?)\s*([\w.]+)\s*\}\}/g
    )) {
      expect(available).toContain(name!);
      if (marker === "#") {
        opened.push(name!);
      } else if (marker === "/") {
        // Sections must close in the order they were opened.
        expect(opened.pop()).toBe(name!);
      }
    }
    expect(opened).toEqual([]);
  });

  it("names no sender or seller for a report, only the filing authority", () => {
    const details = extractDocumentDetails(
      salesDocument.parsed as ParsedDocument,
      salesDocument.type
    );

    // A report is filed, not exchanged, so there is no counterparty to name.
    expect(details.senderName).toBeUndefined();
    expect(details).not.toHaveProperty("sellerName");
    expect(details).not.toHaveProperty("buyerName");
    expect(details.receiverName).toBe("French tax administration");
    expect(details.documentNumber).toBe("SALES-2026-07-01-GOODS");
  });

  it("refuses to render a report row with no parsed data", () => {
    expect(() =>
      buildFranceB2CReportTemplateData({
        id: "doc_report",
        type: "frenchB2CReport",
        parsed: null,
      } as unknown as PublicTransmittedDocument)
    ).toThrow("French B2C report document missing parsed data");
  });
});
