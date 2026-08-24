import { describe, expect, it } from "bun:test";
import {
  buildFranceB2BiReportTemplateData,
  isRenderableDocumentType,
} from "../utils/document-renderer";
import type { PublicTransmittedDocument } from "../data/transmitted-documents";
import type { FrenchB2BiReport } from "../utils/parsing/b2bi-reporting/france";
import { getDocumentType } from "../utils/type-repository/document-types";
import { FRANCE_B2BI_REPORT_TEMPLATE } from "../templates/france-b2bi-report";
import {
  frenchB2BiReportSchema,
  getFrenchB2BiReportDocumentProfile,
} from "../utils/parsing/b2bi-reporting/france";

function documentFor(report: unknown): PublicTransmittedDocument {
  const parsed = frenchB2BiReportSchema.parse(report);
  return {
    id: "doc_report",
    type: getFrenchB2BiReportDocumentProfile(parsed.type).type,
    parsed,
  } as unknown as PublicTransmittedDocument;
}

function templateDataFor(document: PublicTransmittedDocument) {
  return buildFranceB2BiReportTemplateData(document.parsed as FrenchB2BiReport, {
    documentId: document.id,
    type: document.type,
    documentTypeTitle:
      getDocumentType(document.type)?.translatableTitle ?? "Document",
  });
}

const invoiceDocument = documentFor({
  reference: "acme-inv-2026-000431",
  type: "invoice",
  documentNumber: "INV-2026-000431",
  issueDate: "2026-01-15",
  dueDate: "2026-02-14",
  buyer: {
    enterpriseNumber: "IT00987654321",
    enterpriseNumberScheme: "0223",
    vatNumber: "IT00987654321",
    country: "IT",
  },
  taxExclusiveAmount: "10000.00",
  taxAmount: "0.00",
  vatBreakdown: [
    {
      percentage: "0.00",
      taxableAmount: "10000.00",
      taxAmount: "0.00",
      category: "K",
      exemptionReason: "Intra-Community supply",
      exemptionReasonCode: "VATEX-EU-IC",
    },
  ],
});

const paymentDocument = documentFor({
  reference: "acme-pay-2026-000431",
  action: "correct",
  type: "payment",
  invoiceNumber: "INV-2026-000431",
  issueDate: "2026-01-15",
  date: "2026-02-10",
  vatBreakdown: [{ percentage: "20.00", amount: "12000.00" }],
});

describe("French cross-border report rendering", () => {
  it("renders both report types like any other document", () => {
    expect(isRenderableDocumentType("frenchB2BiInvoiceReport")).toBe(true);
    expect(isRenderableDocumentType("frenchB2BiPaymentReport")).toBe(true);
  });

  it("uses the document type the report was filed as", () => {
    expect(invoiceDocument.type).toBe("frenchB2BiInvoiceReport");
    expect(paymentDocument.type).toBe("frenchB2BiPaymentReport");
  });

  it("lays out an invoice report with its buyer and VAT breakdown", () => {
    const data = templateDataFor(invoiceDocument);

    expect(data).toMatchObject({
      reference: "acme-inv-2026-000431",
      reportTypeLabel: "Cross-border invoice",
      dateLabel: "Issue date",
      date: "2026-01-15",
      actionLabel: "Submission",
      isInvoice: true,
      isPayment: false,
      documentKindLabel: "Invoice",
      documentNumber: "INV-2026-000431",
      dueDate: "2026-02-14",
      buyerScheme: "0223",
      buyerCompanyId: "IT00987654321",
      buyerVatNumber: "IT00987654321",
      buyerCountry: "IT",
      currency: "EUR",
    });
    expect(data.invoiceVatBreakdown).toEqual([
      {
        percentage: "0.00",
        taxableAmount: "10000.00",
        taxAmount: "0.00",
        category: "K",
        exemptionReason: "Intra-Community supply",
        currency: "EUR",
      },
    ]);
    expect(data.paymentVatBreakdown).toEqual([]);
    expect(data.invoiceNumber).toBeUndefined();
  });

  it("lays out a payment report against the invoice it belongs to", () => {
    const data = templateDataFor(paymentDocument);

    expect(data).toMatchObject({
      reference: "acme-pay-2026-000431",
      reportTypeLabel: "Cross-border payment received",
      dateLabel: "Payment date",
      date: "2026-02-10",
      actionLabel: "Correction",
      isCorrection: true,
      isInvoice: false,
      isPayment: true,
      invoiceNumber: "INV-2026-000431",
      issueDate: "2026-01-15",
    });
    // A payment report names no buyer and no document totals of its own.
    expect(data.buyerCompanyId).toBeUndefined();
    expect(data.taxExclusiveAmount).toBeUndefined();
    expect(data.invoiceVatBreakdown).toEqual([]);
    expect(data.paymentVatBreakdown).toEqual([
      { percentage: "20.00", amount: "12000.00", currency: "EUR" },
    ]);
  });

  it("only uses placeholders the template data provides", () => {
    // The template is an untyped string, so a typo would silently render a blank.
    const data = templateDataFor(invoiceDocument);
    const available = new Set([
      ...Object.keys(data),
      ...Object.keys(data.invoiceVatBreakdown[0] ?? {}),
      ...Object.keys(
        templateDataFor(paymentDocument).paymentVatBreakdown[0] ?? {}
      ),
    ]);

    const opened: string[] = [];
    for (const [, marker, name] of FRANCE_B2BI_REPORT_TEMPLATE.matchAll(
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

  it("names no counterparty for a report, only the filing authority", () => {
    const details = getDocumentType(invoiceDocument.type)!.email!
      .extractDocumentDetails(invoiceDocument.parsed);

    expect(details.receiverName).toBe("French tax administration");
    expect(details.documentNumber).toBe("acme-inv-2026-000431");
    expect(details.amount).toBe("10000.00");
    expect(details.currency).toBe("EUR");
  });
});
