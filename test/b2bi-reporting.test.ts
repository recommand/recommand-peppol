import { describe, expect, it } from "bun:test";
import {
  buildFrenchSeller,
  toArratechB2BiFlow,
} from "../data/at/fr-reporting";
import {
  frenchB2BiReportSchema,
  getFrenchB2BiReportDocumentProfile,
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
      issueDate: "2026-01-15",
      dueDate: "2026-02-14",
      buyer: {
        enterpriseNumber: "IT00987654321",
        enterpriseNumberScheme: "0223",
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

    expect(toArratechB2BiFlow(report, declarant, seller)).toEqual({
      profile: "FR-F10",
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
          cadre: "S1",
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

  it("reports a credit note under its own type code and omits fields it has no value for", () => {
    const report = frenchB2BiReportSchema.parse({
      reference: "acme-cn-2026-000012",
      type: "invoice",
      documentNumber: "CN-2026-000012",
      documentType: "creditNote",
      issueDate: "2026-01-20",
      currency: "USD",
      buyer: {
        enterpriseNumber: "US123456789",
        enterpriseNumberScheme: "0060",
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
      companyId: "US123456789",
      schemeId: "0060",
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

    expect(toArratechB2BiFlow(report, declarant, seller)).toEqual({
      profile: "FR-F10",
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

  it("corrects and cancels under the reference of the report it acts on", () => {
    const base = {
      reference: "acme-inv-2026-000431",
      type: "payment",
      invoiceNumber: "INV-2026-000431",
      issueDate: "2026-01-15",
      date: "2026-02-10",
      vatBreakdown: [{ percentage: "20.00", amount: "12000.00" }],
    };

    const correction = toArratechB2BiFlow(
      frenchB2BiReportSchema.parse({ ...base, action: "correct" }),
      declarant,
      seller
    );
    expect(correction.event.transmissionType).toBe("RE");
    expect(correction.event.operation).toBe("SUBMIT");
    expect(correction.event.clientOperationRef).toBe("acme-inv-2026-000431");

    const cancellation = toArratechB2BiFlow(
      frenchB2BiReportSchema.parse({ ...base, action: "cancel" }),
      declarant,
      seller
    );
    expect(cancellation.event.operation).toBe("CANCEL");
    expect(cancellation.event.clientOperationRef).toBe("acme-inv-2026-000431");
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

    expect(
      buildFrenchSeller({ enterpriseNumber: "332966332", vatNumber: null })
    ).toBeNull();
    expect(
      buildFrenchSeller({ enterpriseNumber: null, vatNumber: "FR12332966332" })
    ).toBeNull();
  });
});
