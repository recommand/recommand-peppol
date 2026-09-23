import { z } from "zod";
import "zod-openapi/extend";
import { zCurrencies } from "@peppol/utils/currencies";
import {
  f10ActionSchema,
  f10AmountSchema,
  f10PercentSchema,
  f10ReferenceSchema,
} from "@peppol/utils/parsing/fr-reporting/shared";
import type { ReportingDocumentTypeKey } from "@peppol/utils/type-repository/document-types/types";

const salesCurrencySchema = zCurrencies.default("EUR").openapi({
  example: "EUR",
  description:
    "Three-letter currency code for the sales amounts excluding VAT. EUR is used when this field is omitted. French VAT amounts are always reported in EUR, including when this field uses another currency.",
});

export const frenchB2CReportActionSchema = f10ActionSchema;

const frenchB2CReportBaseShape = {
  reference: f10ReferenceSchema,
  action: frenchB2CReportActionSchema,
};

const frenchB2CSalesVatSchema = z
  .object({
    percentage: f10PercentSchema.openapi({
      example: "20.00",
      description: "VAT rate applied to these sales.",
    }),
    taxableAmount: f10AmountSchema.openapi({
      example: "10000.00",
      description:
        "Sales amount excluding VAT for this VAT rate, expressed in the report's sales currency.",
    }),
    taxAmount: f10AmountSchema.openapi({
      example: "2000.00",
      description:
        "VAT amount for this VAT rate, expressed in EUR even when the sales currency is different.",
    }),
  })
  .openapi({
    ref: "FrenchB2CSalesVatBreakdown",
    description: "Daily sales totals for one VAT rate.",
  });

const frenchB2CPaymentVatSchema = z
  .object({
    percentage: f10PercentSchema.openapi({
      example: "20.00",
      description: "VAT rate that applies to the received amount.",
    }),
    amount: f10AmountSchema.openapi({
      example: "12000.00",
      description:
        "Amount received including VAT for this VAT rate, expressed in the report's currency.",
    }),
  })
  .openapi({
    ref: "FrenchB2CPaymentVatBreakdown",
    description: "Daily received payment total for one VAT rate.",
  });

export const frenchB2CSalesReportSchema = z
  .object({
    ...frenchB2CReportBaseShape,
    type: z.literal("sales").openapi({
      description:
        "Choose `sales` to report transactions with private individuals. Send one sales report per day, category and currency, regardless of when customers pay.",
    }),
    date: z.string().date().openapi({
      example: "2026-07-01",
      description: "Day on which the reported sales took place.",
    }),
    category: z.enum(["goods", "services"]).openapi({
      example: "goods",
      description:
        "Whether this daily total covers taxable goods or taxable services. Use a separate report when both were sold on the same day. These are the two categories currently supported by this API.",
    }),
    currency: salesCurrencySchema,
    taxExclusiveAmount: f10AmountSchema.openapi({
      example: "10000.00",
      description:
        "Total sales amount excluding VAT for this day and category.",
    }),
    taxAmount: f10AmountSchema.openapi({
      example: "2000.00",
      description:
        "Total VAT amount for this day and category, expressed in EUR even when the sales currency is different.",
    }),
    transactionCount: z.number().int().positive().openapi({
      example: 42,
      description:
        "Number of individual sales included in this daily total. At least 1; a day without sales is not reported.",
    }),
    vatBreakdown: z.array(frenchB2CSalesVatSchema).min(1).openapi({
      description:
        "Breakdown of the daily sales total by VAT rate. Include one entry for every VAT rate used.",
    }),
  })
  .openapi({
    ref: "FrenchB2CSalesReport",
    title: "French B2C sales report",
    description:
      "The normal daily report for sales to private individuals. It records the sale date, category, transaction count, amounts excluding VAT, and VAT totals. Submit it regardless of whether customers paid immediately or will pay later. This does not send invoices to consumers. The current integration supports taxable goods and taxable services only. A day, category and currency are reported once; use `action: correct` with a new reference to replace that report.",
  });

export const frenchB2CPaymentsReportSchema = z
  .object({
    ...frenchB2CReportBaseShape,
    type: z.literal("payments").openapi({
      description:
        "Choose `payments` only to additionally report payments received for services using cash-basis VAT (`TVA sur les encaissements`).",
    }),
    date: z.string().date().openapi({
      example: "2026-07-01",
      description: "Day on which the reported payments were received.",
    }),
    currency: zCurrencies.default("EUR").openapi({
      example: "EUR",
      description:
        "Three-letter currency code of the received amounts. EUR is used when this field is omitted. One report covers one day in one currency.",
    }),
    vatBreakdown: z.array(frenchB2CPaymentVatSchema).min(1).openapi({
      description:
        "Payments received, grouped by VAT rate. Amounts include VAT.",
    }),
  })
  .openapi({
    ref: "FrenchB2CPaymentsReport",
    title: "French B2C payment report",
    description:
      "An additional daily report for payments received for services using cash-basis VAT (`TVA sur les encaissements`), where VAT becomes due when the customer pays. Submit the sales report as usual, then submit this payment report for the day payment is received. Do not use this report for goods or for services where VAT becomes due when invoiced (`TVA sur les débits`); it is only accepted for companies registered with VAT due on payment.",
  });

export const frenchB2CReportSchema = z
  .discriminatedUnion("type", [
    frenchB2CSalesReportSchema,
    frenchB2CPaymentsReportSchema,
  ])
  .openapi({
    ref: "FrenchB2CReport",
    title: "French B2C reporting request",
    description:
      "Choose a sales report for normal daily B2C transaction totals. Choose a payment report only as an additional report for service payments using cash-basis VAT.",
  });

export type FrenchB2CReport = z.infer<typeof frenchB2CReportSchema>;

type FrenchB2CReportDocumentProfile = {
  type: ReportingDocumentTypeKey;
  docTypeId: string;
  processId: string;
};

const salesReportProfile: FrenchB2CReportDocumentProfile = {
  type: "frenchB2CSalesReport",
  docTypeId: "urn:recommand:reporting:france:b2c:sales:1.0",
  processId: "urn:recommand:reporting:france:b2c",
};

const paymentReportProfile: FrenchB2CReportDocumentProfile = {
  type: "frenchB2CPaymentReport",
  docTypeId: "urn:recommand:reporting:france:b2c:payments:1.0",
  processId: "urn:recommand:reporting:france:b2c",
};

/**
 * The document type a report is filed as. Sales and payment reports are distinct
 * filings, so each is recorded under its own document type.
 */
export function getFrenchB2CReportDocumentProfile(
  reportType: FrenchB2CReport["type"]
): FrenchB2CReportDocumentProfile {
  return reportType === "sales"
    ? salesReportProfile
    : paymentReportProfile;
}
