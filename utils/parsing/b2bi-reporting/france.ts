import { z } from "zod";
import "zod-openapi/extend";
import { zCurrencies } from "@peppol/utils/currencies";
import { zodValidIsoIcdSchemeIdentifiers } from "@peppol/utils/iso-icd-scheme-identifiers";
import type { FrenchBillingMode } from "@peppol/utils/parsing/country-specific/france";
import { vatCategoryEnum } from "@peppol/utils/parsing/invoice/schemas";
import {
  f10ActionSchema,
  f10AmountSchema,
  f10PercentSchema,
  f10ReferenceSchema,
  isEuCountry,
} from "@peppol/utils/parsing/fr-reporting/shared";
import type { ReportingDocumentTypeKey } from "@peppol/utils/type-repository/document-types/types";

const frenchB2BiReportBaseShape = {
  reference: f10ReferenceSchema.openapi({
    example: "EREPORT-INV-2026-000431",
  }),
  action: f10ActionSchema,
};

/**
 * The invoicing framework the reported document belongs to, in the same codes and
 * with the same meaning as the `billingMode` of a French regulated invoice. The code
 * has to match what was actually invoiced: it is checked against the invoice when the
 * reporting period is assembled, not when the report is submitted.
 *
 * These are the frameworks confirmed for cross-border reporting. Other `billingMode`
 * codes an invoice can carry are not supported on a report by this integration.
 */
export const frenchReportingBillingModes = [
  "B1",
  "S1",
  "M1",
  "B2",
  "S2",
  "M2",
  "B4",
  "S4",
  "M4",
] as const;

// Every reporting framework is one of the invoice frameworks; the compiler holds the
// two lists together if either one changes.
type ReportingBillingModesAreInvoiceBillingModes =
  (typeof frenchReportingBillingModes)[number] extends FrenchBillingMode ? true : never;
const _reportingBillingModesAreInvoiceBillingModes: ReportingBillingModesAreInvoiceBillingModes = true;

export const frenchReportingBillingModeSchema = z
  .enum(frenchReportingBillingModes)
  .openapi({
    example: "B1",
    description: `The invoicing framework the reported document belongs to, in the same codes as the \`billingMode\` of a French regulated invoice. Use the code that matches the invoice.

| Mode | Description |
| --- | --- |
| \`B1\` | Goods invoice. |
| \`S1\` | Services invoice. |
| \`M1\` | Mixed invoice containing goods and services that are not ancillary to each other. |
| \`B2\` | Goods invoice that has already been paid. |
| \`S2\` | Services invoice that has already been paid. |
| \`M2\` | Mixed invoice that has already been paid. |
| \`B4\` | Final goods invoice after an advance payment. |
| \`S4\` | Final services invoice after an advance payment. |
| \`M4\` | Final mixed invoice after an advance payment. |

This code is checked against the invoice when the reporting period is assembled, which is after the report is accepted. A framework that does not match the invoice can cause the filing for that period to be rejected, so set it from the invoice rather than from a default.`,
  });

export type FrenchReportingBillingMode = z.infer<typeof frenchReportingBillingModeSchema>;

/**
 * The tax administration identifies a foreign buyer by where it is established: EU
 * buyers by their intra-community VAT number, buyers outside the EU by their
 * country and name, and buyers in the French overseas collectivities by their
 * local registry number. The public schema therefore asks for the country and the
 * name up front, and for the VAT number when the buyer is in the EU.
 */
const frenchB2BiBuyerSchema = z
  .object({
    name: z.string().min(1).openapi({
      example: "Rossi Forniture S.r.l.",
      description: "The buyer's legal name.",
    }),
    country: z
      .string()
      .length(2, "Country code must be in ISO 3166-1:Alpha2 format")
      .transform((value) => value.toUpperCase())
      .openapi({
        // The transform only uppercases, so input and output are the same
        // string. Saying so lets this schema be rendered in a response too,
        // which it is: a stored cross-border report is returned as a
        // document's `parsed` payload.
        effectType: "same",
        example: "IT",
        description:
          "The country the buyer is established in, in ISO 3166-1:Alpha2 format. Must not be `FR`: invoices to French buyers are exchanged over the e-invoicing network instead of being reported.",
      }),
    vatNumber: z.string().min(1).nullish().openapi({
      example: "IT00987654321",
      description:
        "The buyer's intra-community VAT number. Required for buyers established in the European Union; it is how the tax administration identifies them. Leave it off for buyers outside the European Union, who are identified by their country and name instead.",
    }),
    enterpriseNumber: z.string().min(1).nullish().openapi({
      example: "0123456",
      description:
        "The buyer's company registration number. Used for buyers in Nouvelle-Calédonie (RIDET) and Polynésie française (TAHITI); optional elsewhere.",
    }),
    enterpriseNumberScheme: zodValidIsoIcdSchemeIdentifiers.nullish().openapi({
      example: "0223",
      description:
        "The scheme the buyer's company registration number belongs to. Schemes can be found [here](https://docs.peppol.eu/poacc/billing/3.0/codelist/ICD/).",
    }),
  })
  .superRefine((buyer, ctx) => {
    if (isEuCountry(buyer.country) && !buyer.vatNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vatNumber"],
        message: "A VAT number is required for buyers established in the European Union",
      });
    }
    if (
      (buyer.country === "NC" || buyer.country === "PF") &&
      !buyer.enterpriseNumber
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enterpriseNumber"],
        message:
          "A registration number (RIDET or TAHITI) is required for buyers in Nouvelle-Calédonie and Polynésie française",
      });
    }
  })
  .openapi({
    ref: "FrenchB2BiBuyer",
    description: "The foreign business the reported operation was invoiced to.",
  });

export type FrenchB2BiBuyer = z.infer<typeof frenchB2BiBuyerSchema>;

const frenchB2BiInvoiceVatSchema = z
  .object({
    percentage: f10PercentSchema.openapi({
      example: "0.00",
      description: "VAT rate applied to this part of the invoice.",
    }),
    taxableAmount: f10AmountSchema.openapi({
      example: "10000.00",
      description: "Amount excluding VAT taxed at this rate.",
    }),
    taxAmount: f10AmountSchema.openapi({
      example: "0.00",
      description: "VAT amount for this rate.",
    }),
    category: vatCategoryEnum.openapi({
      example: "K",
      description:
        "VAT category code for this rate. Cross-border operations are typically exempt or reverse charged rather than taxed.",
    }),
    exemptionReason: z.string().nullish().openapi({
      example: "Intra-Community supply",
      description:
        "Why no VAT is charged. Required, together with or instead of `exemptionReasonCode`, whenever the VAT category is an exempt one.",
    }),
    exemptionReasonCode: z.string().nullish().openapi({
      example: "VATEX-EU-IC",
      description:
        "The exemption reason code, from the CEF VATEX code list found [here](https://docs.peppol.eu/poacc/billing/3.0/2024-Q4/codelist/vatex/).",
    }),
  })
  .openapi({
    ref: "FrenchB2BiInvoiceVatBreakdown",
    description: "Invoice totals for one VAT rate.",
  });

const frenchB2BiPaymentVatSchema = z
  .object({
    percentage: f10PercentSchema.openapi({
      example: "20.00",
      description: "VAT rate that applies to the received amount.",
    }),
    amount: f10AmountSchema.openapi({
      example: "12000.00",
      description: "Amount received including VAT for this VAT rate.",
    }),
  })
  .openapi({
    ref: "FrenchB2BiPaymentVatBreakdown",
    description: "Received payment total for one VAT rate.",
  });

const frenchB2BiInvoiceReportShape = {
  ...frenchB2BiReportBaseShape,
  type: z.literal("invoice").openapi({
      description:
        "Choose `invoice` to report a single cross-border invoice or credit note issued to a business.",
    }),
    documentNumber: z.string().min(1).openapi({
      example: "INV-2026-000431",
      description:
        "The number of the invoice or credit note being reported. A payment report refers back to it, and a correction or cancellation is matched on it.",
    }),
    billingMode: frenchReportingBillingModeSchema,
    documentType: z
      .enum(["invoice", "creditNote"])
      .default("invoice")
      .openapi({
        example: "invoice",
        description:
          "Whether the reported document is an invoice or a credit note. Defaults to `invoice`.",
      }),
    issueDate: z.string().date().openapi({
      example: "2026-01-15",
      description: "Date on which the document was issued.",
    }),
    dueDate: z.string().date().nullish().openapi({
      example: "2026-02-14",
      description: "Date on which the amount is due, when the document names one.",
    }),
    currency: zCurrencies.default("EUR").openapi({
      example: "EUR",
      description:
        "Three-letter currency code of the reported amounts. EUR is used when this field is omitted.",
    }),
    buyer: frenchB2BiBuyerSchema,
    taxExclusiveAmount: f10AmountSchema.openapi({
      example: "10000.00",
      description: "Total amount of the document excluding VAT.",
    }),
    taxAmount: f10AmountSchema.openapi({
      example: "0.00",
      description: "Total VAT amount of the document.",
    }),
    vatBreakdown: z.array(frenchB2BiInvoiceVatSchema).min(1).openapi({
      description:
        "Breakdown of the document total by VAT rate. Include one entry for every VAT rate used.",
    }),
} as const;

const frenchB2BiInvoiceReportDescription =
  "Reports one invoice or credit note issued to a business established outside France. These operations are not exchanged over the French e-invoicing network, so they are reported to the French tax administration instead. The reporting company must carry its own French VAT number as well as its SIREN; cross-border reports identify the seller by both.";

export const frenchB2BiInvoiceReportSchema = z
  .object(frenchB2BiInvoiceReportShape)
  .openapi({
    ref: "FrenchB2BiInvoiceReport",
    title: "French cross-border invoice report",
    description: frenchB2BiInvoiceReportDescription,
  });

/**
 * The same report as it was stored. Reports filed before the invoicing framework was
 * asked for carry no `billingMode`, so a stored report is read without it; a new
 * report is not accepted without it.
 */
export const storedFrenchB2BiInvoiceReportSchema = z
  .object({
    ...frenchB2BiInvoiceReportShape,
    billingMode: frenchReportingBillingModeSchema.optional(),
  })
  .openapi({
    ref: "StoredFrenchB2BiInvoiceReport",
    title: "Stored French cross-border invoice report",
    description: `${frenchB2BiInvoiceReportDescription} Reports filed before \`billingMode\` was introduced carry no invoicing framework.`,
  });

export const frenchB2BiPaymentReportSchema = z
  .object({
    ...frenchB2BiReportBaseShape,
    type: z.literal("payment").openapi({
      description:
        "Choose `payment` to report a payment received on a cross-border invoice you reported earlier. One payment report per invoice: a second one replaces the first at the reporting service.",
    }),
    invoiceNumber: z.string().min(1).openapi({
      example: "INV-2026-000431",
      description:
        "The `documentNumber` of the invoice report this payment belongs to. The invoice must have been reported before its payment can be. A payment report is matched on this number: the reporting service keeps one payment report per invoice, and a later one replaces it rather than adding to it.",
    }),
    issueDate: z.string().date().openapi({
      example: "2026-01-15",
      description: "Date on which the invoice was issued.",
    }),
    date: z.string().date().openapi({
      example: "2026-02-10",
      description:
        "Date on which the payment was received. Not part of how the payment report is matched: the invoice number is.",
    }),
    currency: zCurrencies.default("EUR").openapi({
      example: "EUR",
      description:
        "Three-letter currency code of the received amounts. EUR is used when this field is omitted.",
    }),
    vatBreakdown: z.array(frenchB2BiPaymentVatSchema).min(1).openapi({
      description:
        "Amounts received, grouped by VAT rate. Amounts include VAT.",
    }),
  })
  .openapi({
    ref: "FrenchB2BiPaymentReport",
    title: "French cross-border payment report",
    description:
      "Reports a payment received on a cross-border invoice. Report the invoice first, then report the payment for the day it was received. Only accepted for companies registered with VAT due on payment.\n\nThe reporting service keeps one payment report per invoice. A second payment report on the same invoice replaces the one on file instead of being added to it, so separate instalments on one invoice cannot be reported yet. A plain `submit` for an invoice that already has a payment report on file is refused and nothing is filed; use `action: \"correct\"` under a new reference to replace the report on file deliberately, or `action: \"cancel\"` to withdraw it, after which a new payment report for the invoice can be submitted. A retry of the same report under the same reference is always safe.",
  });

export const frenchB2BiReportSchema = z
  .discriminatedUnion("type", [
    frenchB2BiInvoiceReportSchema,
    frenchB2BiPaymentReportSchema,
  ])
  .openapi({
    ref: "FrenchB2BiReport",
    title: "French cross-border reporting request",
    description:
      "Choose an invoice report for a cross-border invoice or credit note, and a payment report for a payment received on one.",
  });

/** A cross-border report as it was stored, including reports filed before `billingMode`. */
export const storedFrenchB2BiReportSchema = z
  .discriminatedUnion("type", [
    storedFrenchB2BiInvoiceReportSchema,
    frenchB2BiPaymentReportSchema,
  ])
  .openapi({
    ref: "StoredFrenchB2BiReport",
    title: "Stored French cross-border report",
    description:
      "A cross-border report as it was filed. Invoice reports filed before the invoicing framework was asked for carry no `billingMode`.",
  });

export type FrenchB2BiReport = z.infer<typeof frenchB2BiReportSchema>;
export type StoredFrenchB2BiReport = z.infer<typeof storedFrenchB2BiReportSchema>;

type FrenchB2BiReportDocumentProfile = {
  type: ReportingDocumentTypeKey;
  docTypeId: string;
  processId: string;
};

const invoiceReportProfile: FrenchB2BiReportDocumentProfile = {
  type: "frenchB2BiInvoiceReport",
  docTypeId: "urn:recommand:reporting:france:b2bi:invoice:1.0",
  processId: "urn:recommand:reporting:france:b2bi",
};

const paymentReportProfile: FrenchB2BiReportDocumentProfile = {
  type: "frenchB2BiPaymentReport",
  docTypeId: "urn:recommand:reporting:france:b2bi:payment:1.0",
  processId: "urn:recommand:reporting:france:b2bi",
};

/**
 * The document type a report is filed as. Invoice and payment reports are distinct
 * filings, so each is recorded under its own document type.
 */
export function getFrenchB2BiReportDocumentProfile(
  reportType: FrenchB2BiReport["type"],
): FrenchB2BiReportDocumentProfile {
  return reportType === "invoice"
    ? invoiceReportProfile
    : paymentReportProfile;
}
