import { describe, expect, it } from "bun:test";
import {
  buildFrenchSeller,
  toArratechB2BiFlow,
  toFrenchReportingBuyer,
} from "../data/at/fr-reporting";
import {
  frenchB2BiReportSchema,
  frenchReportingBillingModes,
  getFrenchB2BiReportDocumentProfile,
  storedFrenchB2BiReportSchema,
} from "../utils/parsing/b2bi-reporting/france";
import { getDocumentFilename } from "../utils/document-filename";

const declarant = {
  siren: "332966332",
  name: "ACME FR",
  role: "SE",
} as const;

const seller = {
  companyId: "332966332",
  schemeId: "0002",
  vatId: "FR12332966332",
  countryId: "FR",
} as const;

describe("French cross-border reporting", () => {
  it("maps a cross-border invoice onto the unitary sales sub-flux", () => {
    const report = frenchB2BiReportSchema.parse({
      reference: "acme-inv-2026-000431",
      type: "invoice",
      documentNumber: "INV-2026-000431",
      billingMode: "B1",
      issueDate: "2026-01-15",
      dueDate: "2026-02-14",
      buyer: {
        name: "Rossi Forniture S.r.l.",
        vatNumber: "IT00987654321",
        country: "IT",
      },
      taxExclusiveAmount: 10000,
      taxAmount: 0,
      vatBreakdown: [
        {
          percentage: 0,
          taxableAmount: "10000",
          taxAmount: "0",
          category: "K",
          exemptionReason: "Intra-Community supply",
          exemptionReasonCode: "VATEX-EU-IC",
        },
      ],
    });

    expect(toArratechB2BiFlow(report, declarant, seller, "PROD")).toEqual({
      profile: "FR-F10",
      environment: "PROD",
      event: {
        declarant,
        clientOperationRef: "acme-inv-2026-000431",
        transmissionType: "IN",
        operation: "SUBMIT",
        subFlux: "10.1",
        payload: {
          id: "INV-2026-000431",
          issueDate: "2026-01-15",
          typeCode: "380",
          currencyCode: "EUR",
          dueDate: "2026-02-14",
          // The framework the report names, not a fixed one.
          cadre: "B1",
          seller,
          buyer: {
            companyId: "IT00987654321",
            schemeId: "0223",
            vatId: "IT00987654321",
            countryId: "IT",
          },
          taxExclusiveAmount: "10000.00",
          taxAmount: "0.00",
          taxSubTotals: [
            {
              taxableAmount: "10000.00",
              taxAmount: "0.00",
              categoryCode: "K",
              percent: "0.00",
              exemptionReason: "Intra-Community supply",
              exemptionReasonCode: "VATEX-EU-IC",
            },
          ],
        },
      },
    });
  });

  it("files every accepted invoicing framework as the cadre of the event", () => {
    for (const billingMode of frenchReportingBillingModes) {
      const report = frenchB2BiReportSchema.parse({
        reference: `acme-inv-${billingMode}`,
        type: "invoice",
        documentNumber: `INV-${billingMode}`,
        billingMode,
        issueDate: "2026-01-15",
        buyer: { name: "Rossi", country: "IT", vatNumber: "IT00987654321" },
        taxExclusiveAmount: "100.00",
        taxAmount: "0.00",
        vatBreakdown: [
          { percentage: "0.00", taxableAmount: "100.00", taxAmount: "0.00", category: "K" },
        ],
      });

      const payload = toArratechB2BiFlow(report, declarant, seller).event.payload as {
        cadre: string;
      };
      expect(payload.cadre).toBe(billingMode);
    }
  });

  it("refuses an invoice report without an invoicing framework, and unsupported ones", () => {
    const base = {
      reference: "acme-inv-2026-000450",
      type: "invoice",
      documentNumber: "INV-2026-000450",
      issueDate: "2026-01-15",
      buyer: { name: "Rossi", country: "IT", vatNumber: "IT00987654321" },
      taxExclusiveAmount: "100.00",
      taxAmount: "0.00",
      vatBreakdown: [
        { percentage: "0.00", taxableAmount: "100.00", taxAmount: "0.00", category: "K" },
      ],
    };

    // The framework decides how the tax administration reads the invoice, so a report
    // that does not name one is refused rather than filed under an assumed default.
    const missing = frenchB2BiReportSchema.safeParse(base);
    expect(missing.success).toBe(false);
    expect(missing.success ? [] : missing.error.issues.map((issue) => issue.path.join("."))).toContain(
      "billingMode",
    );

    // Codes an invoice can carry that are not confirmed for a report are refused here
    // rather than sent on.
    for (const billingMode of ["S3", "S5", "S6", "B7", "S7", "B8", "M8", "B9", "X1", "b1", ""]) {
      expect(frenchB2BiReportSchema.safeParse({ ...base, billingMode }).success).toBe(false);
    }
  });

  it("reads back a report that was filed before the framework was part of a report", () => {
    // Reports already on file carry no framework. They stay readable, and the reading
    // does not invent one for them.
    const stored = {
      reference: "acme-inv-2026-000200",
      action: "submit",
      type: "invoice",
      documentNumber: "INV-2026-000200",
      documentType: "invoice",
      issueDate: "2026-01-15",
      currency: "EUR",
      buyer: { name: "Rossi", country: "IT", vatNumber: "IT00987654321" },
      taxExclusiveAmount: "100.00",
      taxAmount: "0.00",
      vatBreakdown: [
        { percentage: "0.00", taxableAmount: "100.00", taxAmount: "0.00", category: "K" },
      ],
    };

    expect(frenchB2BiReportSchema.safeParse(stored).success).toBe(false);
    const legacy = storedFrenchB2BiReportSchema.parse(stored);
    expect(legacy.type === "invoice" && legacy.billingMode).toBeUndefined();
  });

  it("identifies buyers the way the tax administration does, not by ICD scheme", () => {
    // EU: the intra-community VAT number is the company id, under the fiscal code
    // 0223, whatever registry number the buyer also has.
    expect(
      toFrenchReportingBuyer({
        name: "Bakkerij Janssens BV",
        country: "be",
        vatNumber: "BE0123456749",
        enterpriseNumber: "0123456749",
        enterpriseNumberScheme: "0208",
      }),
    ).toEqual({
      companyId: "BE0123456749",
      schemeId: "0223",
      vatId: "BE0123456749",
      countryId: "BE",
    });

    // Outside the EU: a constructed id of country code and the first 16 characters
    // of the name, under 0227, with no VAT number required.
    expect(
      toFrenchReportingBuyer({
        name: "Northwind Traders Incorporated",
        country: "US",
      }),
    ).toEqual({
      companyId: "USNorthwind Trader",
      schemeId: "0227",
      countryId: "US",
    });

    // The French overseas collectivities outside the EU VAT territory use their own
    // registries.
    expect(
      toFrenchReportingBuyer({
        name: "Pacifique SARL",
        country: "NC",
        enterpriseNumber: "1234567",
      }),
    ).toMatchObject({ companyId: "1234567", schemeId: "0228", countryId: "NC" });
    expect(
      toFrenchReportingBuyer({
        name: "Tahiti Nui SA",
        country: "PF",
        enterpriseNumber: "A12345",
      }),
    ).toMatchObject({ companyId: "A12345", schemeId: "0229", countryId: "PF" });
  });

  it("requires the identifiers each kind of buyer is reported under", () => {
    const base = {
      reference: "acme-inv-2026-000440",
      type: "invoice",
      documentNumber: "INV-2026-000440",
      billingMode: "S1",
      issueDate: "2026-01-15",
      taxExclusiveAmount: "100.00",
      taxAmount: "0.00",
      vatBreakdown: [
        { percentage: "0.00", taxableAmount: "100.00", taxAmount: "0.00", category: "K" },
      ],
    };

    const euWithoutVat = frenchB2BiReportSchema.safeParse({
      ...base,
      buyer: { name: "Rossi", country: "IT" },
    });
    expect(euWithoutVat.success).toBe(false);

    const collectivityWithoutRegistry = frenchB2BiReportSchema.safeParse({
      ...base,
      buyer: { name: "Pacifique", country: "NC" },
    });
    expect(collectivityWithoutRegistry.success).toBe(false);

    const nonEu = frenchB2BiReportSchema.safeParse({
      ...base,
      buyer: { name: "Northwind", country: "US" },
    });
    expect(nonEu.success).toBe(true);

    const nameless = frenchB2BiReportSchema.safeParse({
      ...base,
      buyer: { country: "US" },
    });
    expect(nameless.success).toBe(false);
  });

  it("reports a credit note under its own type code and omits fields it has no value for", () => {
    const report = frenchB2BiReportSchema.parse({
      reference: "acme-cn-2026-000012",
      type: "invoice",
      documentNumber: "CN-2026-000012",
      documentType: "creditNote",
      billingMode: "S1",
      issueDate: "2026-01-20",
      currency: "USD",
      buyer: {
        name: "Northwind Traders",
        country: "US",
      },
      taxExclusiveAmount: "500.00",
      taxAmount: "0.00",
      vatBreakdown: [
        {
          percentage: "0.00",
          taxableAmount: "500.00",
          taxAmount: "0.00",
          category: "G",
        },
      ],
    });

    const payload = toArratechB2BiFlow(report, declarant, seller).event
      .payload as Record<string, unknown>;

    expect(payload.typeCode).toBe("381");
    expect(payload.currencyCode).toBe("USD");
    // A field the report has no value for is left out rather than sent as null.
    expect("dueDate" in payload).toBe(false);
    expect(payload.buyer).toEqual({
      companyId: "USNorthwind Trader",
      schemeId: "0227",
      countryId: "US",
    });
    expect(payload.taxSubTotals).toEqual([
      {
        taxableAmount: "500.00",
        taxAmount: "0.00",
        categoryCode: "G",
        percent: "0.00",
      },
    ]);
  });

  it("ties a payment to the invoice report it belongs to", () => {
    const report = frenchB2BiReportSchema.parse({
      reference: "acme-pay-2026-000431",
      type: "payment",
      invoiceNumber: "INV-2026-000431",
      issueDate: "2026-01-15",
      date: "2026-02-10",
      vatBreakdown: [{ percentage: "20.00", amount: "12000.00" }],
    });

    expect(toArratechB2BiFlow(report, declarant, seller, "TEST")).toEqual({
      profile: "FR-F10",
      environment: "TEST",
      event: {
        declarant,
        clientOperationRef: "acme-pay-2026-000431",
        transmissionType: "IN",
        operation: "SUBMIT",
        subFlux: "10.2",
        payload: {
          invoiceId: "INV-2026-000431",
          issueDate: "2026-01-15",
          paymentDate: "2026-02-10",
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

  it("keeps every subtotal of a payment in the report's currency", () => {
    const report = frenchB2BiReportSchema.parse({
      reference: "acme-pay-2026-000432",
      type: "payment",
      invoiceNumber: "INV-2026-000432",
      issueDate: "2026-01-15",
      date: "2026-02-10",
      currency: "USD",
      vatBreakdown: [
        { percentage: "20.00", amount: "1200.00" },
        { percentage: "10.00", amount: "110.00" },
      ],
    });

    const payload = toArratechB2BiFlow(report, declarant, seller).event
      .payload as { subTotals: { currencyCode: string }[] };

    expect(payload.subTotals.map((subtotal) => subtotal.currencyCode)).toEqual([
      "USD",
      "USD",
    ]);
  });

  it("corrects and cancels under a reference of their own", () => {
    // The reference is the idempotency handle: reusing the original one would be a
    // replay. The invoice number is what ties the correction to the earlier report.
    const base = {
      type: "payment",
      invoiceNumber: "INV-2026-000431",
      issueDate: "2026-01-15",
      date: "2026-02-10",
      vatBreakdown: [{ percentage: "20.00", amount: "12000.00" }],
    };

    const correction = toArratechB2BiFlow(
      frenchB2BiReportSchema.parse({ ...base, reference: "acme-pay-2026-000431-c1", action: "correct" }),
      declarant,
      seller
    );
    expect(correction.event.transmissionType).toBe("RE");
    expect(correction.event.operation).toBe("SUBMIT");
    expect(correction.event.clientOperationRef).toBe("acme-pay-2026-000431-c1");
    expect((correction.event.payload as { invoiceId: string }).invoiceId).toBe("INV-2026-000431");

    const cancellation = toArratechB2BiFlow(
      frenchB2BiReportSchema.parse({ ...base, reference: "acme-pay-2026-000431-x", action: "cancel" }),
      declarant,
      seller
    );
    expect(cancellation.event.operation).toBe("CANCEL");
    expect(cancellation.event.clientOperationRef).toBe("acme-pay-2026-000431-x");
  });

  it("rejects what the tax administration would reject", () => {
    const base = {
      type: "payment",
      invoiceNumber: "INV-2026-000431",
      issueDate: "2026-01-15",
      date: "2026-02-10",
    };

    expect(
      frenchB2BiReportSchema.safeParse({
        ...base,
        reference: "r".repeat(129),
        vatBreakdown: [{ percentage: "20.00", amount: "12000.00" }],
      }).success,
    ).toBe(false);
    expect(
      frenchB2BiReportSchema.safeParse({
        ...base,
        reference: "acme-pay-2026-000431",
        vatBreakdown: [{ percentage: "20.00", amount: "-12000.00" }],
      }).success,
    ).toBe(false);
    expect(
      frenchB2BiReportSchema.safeParse({
        ...base,
        reference: "r".repeat(128),
        vatBreakdown: [{ percentage: 20, amount: 12000 }],
      }).success,
    ).toBe(true);
  });

  it("files invoice and payment reports as distinct document types", () => {
    const invoice = getFrenchB2BiReportDocumentProfile("invoice");
    const payment = getFrenchB2BiReportDocumentProfile("payment");

    expect(invoice.type).toBe("frenchB2BiInvoiceReport");
    expect(payment.type).toBe("frenchB2BiPaymentReport");
    expect(invoice.docTypeId).not.toBe(payment.docTypeId);
  });

  it("names a payment report after its own reference, not the invoice it reports on", () => {
    const report = frenchB2BiReportSchema.parse({
      reference: "acme-pay-2026-000431",
      type: "payment",
      invoiceNumber: "INV-2026-000431",
      issueDate: "2026-01-15",
      date: "2026-02-10",
      vatBreakdown: [{ percentage: "20.00", amount: "12000.00" }],
    });

    expect(getDocumentFilename("frenchB2BiPaymentReport", report)).toBe(
      "french-cross-border-payment-report-acme-pay-2026-000431"
    );
  });

  it("requires a SIREN and a VAT number to name the seller", () => {
    expect(
      buildFrenchSeller({
        enterpriseNumber: "332 966 332",
        vatNumber: "FR12332966332",
      })
    ).toEqual(seller);
    // An establishment's SIRET names the same legal entity.
    expect(
      buildFrenchSeller({
        enterpriseNumber: "33296633200030",
        vatNumber: "FR12332966332",
      })
    ).toEqual(seller);

    expect(
      buildFrenchSeller({ enterpriseNumber: "332966332", vatNumber: null })
    ).toBeNull();
    expect(
      buildFrenchSeller({ enterpriseNumber: null, vatNumber: "FR12332966332" })
    ).toBeNull();
  });
});
