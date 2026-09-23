import { describe, expect, it } from "bun:test";
import {
  buildFrenchDeclarant,
  toArratechB2CFlow,
} from "../data/at/fr-reporting";
import {
  frenchB2CReportSchema,
  getFrenchB2CReportDocumentProfile,
} from "../utils/parsing/b2c-reporting/france";
import { sendDocumentSchema } from "../utils/parsing/send-document";
import { REPORTING_DOCUMENT_TYPE_KEYS } from "../utils/type-repository/document-types/keys";
import { documentFormats } from "../utils/type-repository/document-formats";
import { receivingCapabilities } from "../utils/type-repository/receiving-capabilities";

const declarant = {
  siren: "123456789",
  name: "ACME SARL",
  role: "SE",
} as const;

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
    const report = frenchB2CReportSchema.parse({
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
    expect(toArratechB2CFlow(report, declarant, "PROD")).toEqual({
      profile: "FR-F10",
      environment: "PROD",
      event: {
        declarant,
        clientOperationRef: "SALES-2026-07-01-GOODS",
        transmissionType: "IN",
        operation: "SUBMIT",
        subFlux: "10.3",
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
      },
    });
  });

  it("maps cash-basis payment corrections without exposing provider fields", () => {
    const report = frenchB2CReportSchema.parse({
      reference: "PAYMENTS-2026-07-01-C1",
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

    expect(toArratechB2CFlow(report, declarant, "TEST")).toEqual({
      profile: "FR-F10",
      environment: "TEST",
      event: {
        declarant,
        clientOperationRef: "PAYMENTS-2026-07-01-C1",
        transmissionType: "RE",
        operation: "SUBMIT",
        subFlux: "10.4",
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
      },
    });
  });

  it("cancels under a reference of its own, naming the day it cancels", () => {
    // The reference is the idempotency handle, so a cancellation needs a new one;
    // the day and category in the payload identify the report being cancelled.
    const report = frenchB2CReportSchema.parse({
      reference: "SALES-2026-07-01-SERVICES-CANCEL",
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

    const providerPayload = toArratechB2CFlow(report, declarant);
    expect(providerPayload.event.operation).toBe("CANCEL");
    expect(providerPayload.event.transmissionType).toBe("IN");
    expect(providerPayload.event.clientOperationRef).toBe(
      "SALES-2026-07-01-SERVICES-CANCEL"
    );
    expect(providerPayload.event.payload).toMatchObject({
      date: "2026-07-01",
      categoryCode: "TPS1",
    });
  });

  it("reports payments in the currency of the report", () => {
    const report = frenchB2CReportSchema.parse({
      reference: "PAYMENTS-2026-07-02-CHF",
      type: "payments",
      date: "2026-07-02",
      currency: "CHF",
      vatBreakdown: [{ percentage: "8.10", amount: "1081.00" }],
    });

    const payload = toArratechB2CFlow(report, declarant).event.payload as {
      subTotals: { currencyCode: string }[];
    };
    expect(payload.subTotals[0]!.currencyCode).toBe("CHF");
  });

  it("rejects what the tax administration would reject", () => {
    const negative = frenchB2CReportSchema.safeParse({
      ...salesReport,
      taxAmount: "-2000.00",
    });
    expect(negative.success).toBe(false);

    const overlongReference = frenchB2CReportSchema.safeParse({
      ...salesReport,
      reference: "S".repeat(129),
    });
    expect(overlongReference.success).toBe(false);

    const noTransactions = frenchB2CReportSchema.safeParse({
      ...salesReport,
      transactionCount: 0,
    });
    expect(noTransactions.success).toBe(false);
  });

  it("rejects unsupported sales categories and empty VAT breakdowns", () => {
    const unsupportedCategory = frenchB2CReportSchema.safeParse({
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
    for (const documentType of REPORTING_DOCUMENT_TYPE_KEYS) {
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
    const sales = getFrenchB2CReportDocumentProfile("sales");
    const payments = getFrenchB2CReportDocumentProfile("payments");

    expect(sales.type).toBe("frenchB2CSalesReport");
    expect(payments.type).toBe("frenchB2CPaymentReport");
    expect(sales.docTypeId).not.toBe(payments.docTypeId);
  });

  it("keeps the report document types out of the Peppol sending vocabularies", () => {
    // A report has no XML representation and must never be advertised as an SMP
    // receiving capability, so it belongs to neither registry.
    for (const reportingType of REPORTING_DOCUMENT_TYPE_KEYS) {
      expect(
        documentFormats.some((format) =>
          format.supportedDocumentTypes.some(
            (documentType) => documentType.key === reportingType,
          ),
        ),
      ).toBe(false);
    }
    for (const reportType of ["sales", "payments"] as const) {
      expect(
        receivingCapabilities.some(
          (capability) =>
            capability.docTypeId ===
            getFrenchB2CReportDocumentProfile(reportType).docTypeId,
        ),
      ).toBe(false);
    }
  });

  it("derives the declarant SIREN from a SIREN or SIRET enterprise number", () => {
    const acme = { siren: "303265045", name: "ACME SARL", role: "SE" } as const;
    expect(
      buildFrenchDeclarant({
        name: "ACME SARL",
        enterpriseNumber: "303 265 045",
      })
    ).toEqual(acme);
    // An establishment's SIRET carries the SIREN in its first nine digits.
    expect(
      buildFrenchDeclarant({
        name: "ACME SARL",
        enterpriseNumber: "30326504500011",
      })
    ).toEqual(acme);

    // Anything else, including a number that fails its check digit, cannot stand
    // in for a SIREN.
    for (const enterpriseNumber of [null, "12345678", "1234567890", "FR303265045", "303265046"]) {
      expect(
        buildFrenchDeclarant({ name: "ACME SARL", enterpriseNumber })
      ).toBeNull();
    }
  });
});
