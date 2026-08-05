import { z } from "zod";
import "zod-openapi/extend";
import { zCurrencies } from "@peppol/utils/currencies";
import { decimalSchema } from "@peppol/utils/parsing/invoice/schemas";
import {
  FRANCE_B2C_PAYMENT_REPORT_DOCUMENT_TYPE_INFO,
  FRANCE_B2C_SALES_REPORT_DOCUMENT_TYPE_INFO,
  type ReportingDocumentTypeInfo,
} from "@peppol/utils/document-types";

const salesCurrencySchema = zCurrencies.default("EUR").openapi({
  example: "EUR",
  description:
    "Three-letter currency code for the sales amounts excluding VAT. EUR is used when this field is omitted. French VAT amounts are always reported in EUR, including when this field uses another currency.",
});

export const frenchB2CReportActionSchema = z
  .enum(["submit", "correct", "cancel"])
  .default("submit")
  .openapi({
    example: "submit",
    description:
      "Use `submit` for a new daily report, `correct` to replace a report sent earlier for that day, or `cancel` to cancel it. Defaults to `submit`.",
  });

const frenchB2CReportBaseShape = {
  reference: z.string().min(1).openapi({
    example: "SALES-2026-07-01-GOODS",
    description:
      "Your unique reference for this submission. Reuse it only when retrying the exact same request. Use a new reference for a correction or cancellation.",
  }),
  action: frenchB2CReportActionSchema,
};

const frenchB2CSalesVatSchema = z
  .object({
    percentage: decimalSchema.openapi({
      example: "20.00",
      description: "VAT rate applied to these sales.",
    }),
    taxableAmount: decimalSchema.openapi({
      example: "10000.00",
      description:
        "Sales amount excluding VAT for this VAT rate, expressed in the report's sales currency.",
    }),
    taxAmount: decimalSchema.openapi({
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
    percentage: decimalSchema.openapi({
      example: "20.00",
      description: "VAT rate that applies to the received amount.",
    }),
    amount: decimalSchema.openapi({
      example: "12000.00",
      description:
        "Amount received including VAT for this VAT rate, expressed in EUR.",
    }),
  })
  .openapi({
    ref: "FrenchB2CPaymentVatBreakdown",
    description: "Daily received payment total in EUR for one VAT rate.",
  });

export const frenchB2CSalesReportSchema = z
  .object({
    ...frenchB2CReportBaseShape,
    type: z.literal("sales").openapi({
      description:
        "Choose `sales` to report transactions with private individuals. Send one sales report per day and per category, regardless of when customers pay.",
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
    taxExclusiveAmount: decimalSchema.openapi({
      example: "10000.00",
      description:
        "Total sales amount excluding VAT for this day and category.",
    }),
    taxAmount: decimalSchema.openapi({
      example: "2000.00",
      description:
        "Total VAT amount for this day and category, expressed in EUR even when the sales currency is different.",
    }),
    transactionCount: z.number().int().positive().openapi({
      example: 42,
      description:
        "Number of individual sales included in this daily total.",
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
      "The normal daily report for sales to private individuals. It records the sale date, category, transaction count, amounts excluding VAT, and VAT totals. Submit it regardless of whether customers paid immediately or will pay later. This does not send invoices to consumers. The current integration supports taxable goods and taxable services only.",
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
    vatBreakdown: z.array(frenchB2CPaymentVatSchema).min(1).openapi({
      description:
        "Payments received, grouped by VAT rate. Amounts include VAT and are expressed in EUR.",
    }),
  })
  .openapi({
    ref: "FrenchB2CPaymentsReport",
    title: "French B2C payment report",
    description:
      "An additional daily report for payments received for services using cash-basis VAT (`TVA sur les encaissements`), where VAT becomes due when the customer pays. Submit the sales report as usual, then submit this payment report for the day payment is received. Do not use this report for goods or for services where VAT becomes due when invoiced (`TVA sur les débits`).",
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

/**
 * The document type a report is filed as. Sales and payment reports are distinct
 * filings, so each is recorded under its own document type.
 */
export function getFrenchB2CReportDocumentTypeInfo(
  reportType: FrenchB2CReport["type"]
): ReportingDocumentTypeInfo {
  return reportType === "sales"
    ? FRANCE_B2C_SALES_REPORT_DOCUMENT_TYPE_INFO
    : FRANCE_B2C_PAYMENT_REPORT_DOCUMENT_TYPE_INFO;
}
