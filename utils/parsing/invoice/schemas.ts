import { z } from "zod";
import { Decimal } from "decimal.js";
import "zod-openapi/extend";
import { CURRENCIES, zCurrencies } from "@peppol/utils/currencies";
import { PAYMENT_MEANS } from "@peppol/utils/payment-means";
import { ITEM_TYPE_IDENTIFICATION_CODES } from "@peppol/utils/item-type-identification-codes";
import { zodValidIsoIcdSchemeIdentifiers } from "@peppol/utils/iso-icd-scheme-identifiers";

export const VAT_CATEGORIES = {
  AE: "Vat Reverse Charge",
  E: "Exempt from Tax",
  S: "Standard rate",
  Z: "Zero rated goods",
  G: "Free export item, VAT not charged",
  O: "Services outside scope of tax",
  K: "VAT exempt for EEA intra-community supply",
  L: "Canary Islands general indirect tax",
  M: "Tax for production, services and importation in Ceuta and Melilla",
  B: "Transferred (VAT), In Italy",
} as const;

export type VatCategory = keyof typeof VAT_CATEGORIES;

const toDecimalString = (val: number | string) => new Decimal(val).toFixed(2);
const toUnlimitedDecimalString = (val: number | string) =>
  new Decimal(val).toString();

// Create a reusable decimal transform schema
export const decimalSchema = z
  .union([z.number(), z.string()])
  .refine(
    (val) => {
      try {
        const decimal = new Decimal(val);
        return decimal.isNaN() === false && decimal.isFinite() === true;
      } catch (error) {
        return false;
      }
    },
    { message: "Invalid decimal" }
  )
  .transform(toDecimalString)
  .openapi({
    type: "string",
    example: "21.00",
    description: "Decimal number as a string with 2 decimal places",
  });

export const unlimitedDecimalSchema = z
  .union([z.number(), z.string()])
  .refine(
    (val) => {
      try {
        const decimal = new Decimal(val);
        return decimal.isNaN() === false && decimal.isFinite() === true;
      } catch (error) {
        return false;
      }
    },
    { message: "Invalid decimal" }
  )
  .transform(toUnlimitedDecimalString)
  .openapi({
    type: "string",
    example: "21.00",
    description: "Decimal number as a string with flexible precision",
  });

export function normalizeWhitespaceOnlyText(value: string): string {
  return value.trim() === "" ? "" : value;
}

export const optionalNullishTextSchema = z
  .string()
  .nullish()
  .transform((value) => (value == null ? value : normalizeWhitespaceOnlyText(value)));

export const partySchema = z
  .object({
    vatNumber: optionalNullishTextSchema.openapi({ example: "BE1234567894" }),
    enterpriseNumberScheme: zodValidIsoIcdSchemeIdentifiers.nullish().openapi({ example: "0208", description: "The scheme that corresponds to the enterprise number. Can be found [here](https://docs.peppol.eu/poacc/billing/3.0/codelist/ICD/)." }),
    enterpriseNumber: optionalNullishTextSchema.openapi({ example: "1234567894" }),
    name: z.string().openapi({ example: "Example Company" }),
    street: z.string().openapi({ example: "Example Street 1" }),
    street2: optionalNullishTextSchema.openapi({ example: "Suite 100" }),
    city: z.string().openapi({ example: "Brussels" }),
    postalZone: z.string().openapi({ example: "1000" }),
    country: z
      .string()
      .length(2, "Country code must be in ISO 3166-1:Alpha2 format")
      .openapi({ example: "BE" }),
    email: optionalNullishTextSchema.openapi({
      example: "email@example.com",
      description:
        "The email address of the party. If not provided, the email address will not be included in the document.",
    }),
    phone: optionalNullishTextSchema.openapi({
      example: "887 654 321",
      description:
        "The phone number of the party. Must contain at least 3 digits. If not provided, the phone number will not be included in the document.",
    }),
  })
  .openapi({ ref: "Party" });

export const deliverySchema = z
  .object({
    date: z.string().date().nullish().openapi({
      example: "2025-03-20",
      description: "The date of the delivery.",
    }),
    locationIdentifier: z
      .object({
        scheme: z.string().openapi({ example: "0088" }),
        identifier: z.string().openapi({ example: "123456789" }),
      })
      .nullish()
      .openapi({
        example: { scheme: "0088", identifier: "123456789" },
        description:
          "The identifier of the delivery location. Schemes can be found [here](https://docs.peppol.eu/poacc/billing/3.0/codelist/ICD/).",
      }),
    location: z.object({
      street: optionalNullishTextSchema.openapi({ example: "Example Street 1" }),
      street2: optionalNullishTextSchema.openapi({ example: "Suite 100" }),
      city: optionalNullishTextSchema.openapi({ example: "Brussels" }),
      postalZone: optionalNullishTextSchema.openapi({ example: "1000" }),
      country: z
        .string()
        .length(2, "Country code must be in ISO 3166-1:Alpha2 format")
        .openapi({ example: "BE" }),
    }),
    recipientName: z.string().openapi({
      example: "Company Ltd.",
      description:
        "The name of the party to which the goods and services are delivered.",
    }),
  })
  .partial()
  .openapi({ ref: "Delivery" });

export const paymentMeansSchema = z
  .object({
    name: optionalNullishTextSchema.openapi({
      example: "Credit Transfer",
      description: "The name of the payment means.",
    }),
    paymentMethod: z
      .enum([
        ...(PAYMENT_MEANS.map((payment) => payment.key) as [
          string,
          ...string[],
        ]),
        "other",
      ])
      .default("credit_transfer")
      .openapi({ example: "credit_transfer" }),
    reference: optionalNullishTextSchema.default("").openapi({ example: "INV-2026-001" }),
    iban: z.string().openapi({ example: "BE1234567890" }),
    financialInstitutionBranch: optionalNullishTextSchema.openapi({
      description:
        "An identifier for the payment service provider where a payment account is located. Such as a BIC or a national clearing code where required.",
    }),
  })
  .openapi({ ref: "PaymentMeans" });

export const vatCategoryEnum = z
  .enum(Object.keys(VAT_CATEGORIES) as [VatCategory, ...VatCategory[]])
  .openapi({
    example: "S",
    description:
      "VAT category code. All codes can be found [here](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL5305/). When sending regular invoices, you should most often use the `S` category. When sending an invoice to another EU country, use the `AE` category for VAT Reverse Charge. In those cases, it is still recommended to include a note in the invoice explaining that the VAT Reverse Charge applies.",
    enum: Object.keys(VAT_CATEGORIES),
  });

export const vatSchema = z
  .object({
    category: vatCategoryEnum.default("S"),
    percentage: decimalSchema,
  })
  .openapi({ ref: "VAT" });

export const vatSubtotalSchema = z
  .object({
    taxableAmount: decimalSchema,
    vatAmount: decimalSchema,
    category: vatCategoryEnum,
    percentage: decimalSchema,
    exemptionReasonCode: optionalNullishTextSchema.openapi({
      description:
        "If the invoice is exempt from VAT, this (or exemptionReason) is required. The exemption reason code identifier must belong to the CEF VATEX code list	found [here](https://docs.peppol.eu/poacc/billing/3.0/2024-Q4/codelist/vatex/).",
    }),
    exemptionReason: optionalNullishTextSchema.openapi({
      description:
        "If the invoice is exempt from VAT, this (or exemptionReasonCode) is required. The exemption reason must be a textual statement of the reason why the amount is exempt from VAT or why no VAT is charged.",
    }),
  })
  .openapi({ ref: "VATSubtotal" });

export const totalsSchema = z
  .object({
    linesAmount: decimalSchema.nullish().openapi({
      description:
        "The tax exclusive total amount of all lines. Rounded to 2 decimal places.",
    }),
    discountAmount: decimalSchema.nullish().openapi({
      description:
        "The tax exclusive total amount of all discounts. If not provided, this will be calculated automatically.",
    }),
    surchargeAmount: decimalSchema.nullish().openapi({
      description:
        "The tax exclusive total amount of all surcharges. If not provided, this will be calculated automatically.",
    }),
    taxExclusiveAmount: decimalSchema.openapi({
      description:
        "The tax exclusive total amount of all lines, discounts and surcharges. Rounded to 2 decimal places.",
    }),
    taxInclusiveAmount: decimalSchema.openapi({
      description:
        "The tax inclusive total amount of all lines, discounts and surcharges. Rounded to 2 decimal places.",
    }),
    payableAmount: decimalSchema.nullish().openapi({
      description:
        "The amount to be paid. If not provided, this will be taxInclusiveAmount. Can be used in combination with paidAmount to indicate partial payment or payment rounding. Rounded to 2 decimal places.",
    }),
    paidAmount: decimalSchema.nullish().openapi({
      description:
        "The amount paid. If not provided, this will be taxInclusiveAmount - payableAmount. Can be used in combination with payableAmount to indicate partial payment or payment rounding. Rounded to 2 decimal places.",
    }),
  })
  .openapi({
    ref: "Totals",
    description:
      "If not provided, the totals will be calculated from the document lines.",
  });

export const lineDiscountSchema = z
  .object({
    reasonCode: optionalNullishTextSchema.openapi({
      example: "95",
      description:
        "The reason code for the discount. This must be one of the codes in the [UNCL5189 subset](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL5189/) code list. For example, `95` for regular discounts. Either reason or reasonCode must be provided.",
    }),
    reason: optionalNullishTextSchema.openapi({
      example: "Discount",
      description:
        "The reason for the discount. This is a free text field. Either reason or reasonCode must be provided.",
    }),
    amount: decimalSchema,
  })
  .refine((data) => data.reasonCode || data.reason, {
    message: "Either reason or reasonCode must be provided.",
  })
  .openapi({ ref: "LineDiscount" });

export const lineSurchargeSchema = z
  .object({
    reasonCode: optionalNullishTextSchema.openapi({
      example: "FC",
      description:
        "The reason code for the surcharge. This must be one of the codes in the [UNCL7161 subset](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL7161/) code list. For example, `FC` for freight services. Either reason or reasonCode must be provided.",
    }),
    reason: optionalNullishTextSchema.openapi({
      example: "Freight services",
      description:
        "The reason for the surcharge. This is a free text field. Either reason or reasonCode must be provided.",
    }),
    amount: decimalSchema,
  })
  .refine((data) => data.reasonCode || data.reason, {
    message: "Either reason or reasonCode must be provided.",
  })
  .openapi({ ref: "LineSurcharge" });

export const additionalItemPropertySchema = z
  .object({
    name: z.string().openapi({ example: "Color" }),
    value: z.string().openapi({ example: "Red" }),
  })
  .openapi({ ref: "AdditionalItemProperty" });

export const itemClassificationCodeSchema = z
  .object({
    scheme: z.enum(ITEM_TYPE_IDENTIFICATION_CODES.map((code) => code.key) as [string, ...string[]]).openapi({ example: "SN", description: "The scheme of the item classification code. Can be found [here](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL7143/)." }),
    schemeVersion: optionalNullishTextSchema,
    value: z.string().min(1).openapi({ example: "123456", description: "The value of the item classification code." }),
  })
  .openapi({ ref: "ItemClassificationCode" });

export const lineSchema = z
  .object({
    id: optionalNullishTextSchema.openapi({
      example: "1",
      description:
        "A line number. If not provided, it will be calculated automatically.",
    }),
    name: z.string().default("").openapi({ example: "Consulting Services" }),
    description: optionalNullishTextSchema.openapi({ example: "Professional consulting services" }),
    note: optionalNullishTextSchema.openapi({
      description:
        "A textual note that gives unstructured information that is relevant to this line.",
    }),
    buyersId: optionalNullishTextSchema.openapi({
      example: "CS-001",
      description: "The item identifier of the item as defined by the buyer.",
    }),
    sellersId: optionalNullishTextSchema.openapi({
      example: "CS-001",
      description:
        "The item identifier of the item as defined by the seller. This is typically a product code or SKU.",
    }),
    standardId: z
      .object({
        scheme: z.string().openapi({ example: "0160" }),
        identifier: z.string().openapi({ example: "10986700" }),
      })
      .nullish()
      .openapi({
        description:
          "The standard identifier of the item based on a registered scheme. Schemes can be found [here](https://docs.peppol.eu/poacc/billing/3.0/codelist/ICD/).",
      }),
    documentReference: optionalNullishTextSchema.openapi({
      example: "INV-2024-001",
      description:
        "A reference to a related document, mostly used to refer to a related invoice.",
    }),
    orderLineReference: optionalNullishTextSchema.openapi({
      description: "A reference to a related order line.",
    }),
    commodityClassifications: z.array(itemClassificationCodeSchema).nullish().openapi({ description: "Optional commodity classifications" }),
    additionalItemProperties: z
      .array(additionalItemPropertySchema)
      .nullish()
      .openapi({ description: "Optional additional item properties" }),
    originCountry: z
      .string()
      .length(2, "Country code must be in ISO 3166-1:Alpha2 format")
      .nullish()
      .openapi({
        example: "BE",
        description: "The country of origin of the item.",
      }),
    quantity: unlimitedDecimalSchema.default("1.00"),
    unitCode: z.string().default("C62").openapi({
      example: "HUR",
      description:
        "Recommended unit codes can be found [here](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNECERec20/).",
    }),
    netPriceAmount: unlimitedDecimalSchema,
    baseQuantity: unlimitedDecimalSchema.nullish().openapi({
      example: "1",
      description:
        "The number of units to which the price refers. When greater than 1, the price is for a batch/pack of this size. The actual unit price is netPriceAmount / baseQuantity.",
    }),
    discounts: z
      .array(lineDiscountSchema)
      .nullish()
      .openapi({ description: "Optional discounts for the line" }),
    surcharges: z
      .array(lineSurchargeSchema)
      .nullish()
      .openapi({ description: "Optional surcharges for the line" }),
    netAmount: decimalSchema.nullish().openapi({
      description:
        "The total net amount of the line: quantity * netPriceAmount. Rounded to 2 decimal places. If not provided, it will be calculated automatically.",
    }),
    vat: vatSchema,
  })
  .openapi({ ref: "Line" });

export const discountSchema = z
  .object({
    reasonCode: optionalNullishTextSchema.openapi({
      example: "95",
      description:
        "The reason code for the discount. This must be one of the codes in the [UNCL5189 subset](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL5189/) code list. For example, `95` for regular discounts. Either reason or reasonCode must be provided.",
    }),
    reason: optionalNullishTextSchema.openapi({
      example: "Discount",
      description:
        "The reason for the discount. This is a free text field. Either reason or reasonCode must be provided.",
    }),
    amount: decimalSchema,
    vat: vatSchema,
  })
  .refine((data) => data.reasonCode || data.reason, {
    message: "Either reason or reasonCode must be provided.",
  })
  .openapi({ ref: "Discount" });

export const surchargeSchema = z
  .object({
    reasonCode: optionalNullishTextSchema.openapi({
      example: "FC",
      description:
        "The reason code for the surcharge. This must be one of the codes in the [UNCL7161 subset](https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL7161/) code list. For example, `FC` for freight services. Either reason or reasonCode must be provided.",
    }),
    reason: optionalNullishTextSchema.openapi({
      example: "Freight services",
      description:
        "The reason for the surcharge. This is a free text field. Either reason or reasonCode must be provided.",
    }),
    amount: decimalSchema,
    vat: vatSchema,
  })
  .refine((data) => data.reasonCode || data.reason, {
    message: "Either reason or reasonCode must be provided.",
  })
  .openapi({ ref: "Surcharge" });

export const vatTotalsSchema = z
  .object({
    totalVatAmount: decimalSchema,
    subtotals: z.array(vatSubtotalSchema),
  })
  .openapi({ ref: "VatTotals", title: "Provided VAT totals" });

export const sendVatTotalsSchema = z.union([
  vatTotalsSchema,
  z
    .object({
      exemptionReasonCode: optionalNullishTextSchema.openapi({
        description:
          "If the invoice is exempt from VAT, this (or exemptionReason) is required. The exemption reason code identifier must belong to the CEF VATEX code list	found [here](https://docs.peppol.eu/poacc/billing/3.0/2024-Q4/codelist/vatex/).",
      }),
      exemptionReason: optionalNullishTextSchema.openapi({
        description:
          "If the invoice is exempt from VAT, this (or exemptionReasonCode) is required. The exemption reason must be a textual statement of the reason why the amount is exempt from VAT or why no VAT is charged.",
      }),
    })
    .openapi({
      ref: "VatTotalsAutoCalculation",
      title: "VAT totals auto calculation",
      description:
        "Recommand will automatically calculate the VAT totals based on the document lines. For invoices that are exempt from VAT, you can provide the exemption reason or reason code here to inform the recipient of the reason why the amount is exempt from VAT.",
    }),
]);

export const attachmentSchema = z
  .object({
    id: z.string().openapi({ example: "ATT-001" }),
    mimeCode: z.string().default("application/pdf").openapi({
      example: "application/pdf",
      description:
        "MIME type of the document (e.g. application/pdf, text/csv, image/png)",
    }),
    filename: z.string().openapi({
      example: "contract.pdf",
      description:
        "Filename for an embedded attachment. This is included in the Peppol XML only when `embeddedDocument` is provided. For URL-only attachments, the document contains an external reference and the filename is not embedded.",
    }),
    description: optionalNullishTextSchema.openapi({ example: "Signed contract" }),
    embeddedDocument: optionalNullishTextSchema.openapi({ description: "base64 encoded document" }),
    url: optionalNullishTextSchema.openapi({ example: "https://example.com/contract.pdf" }),
  })
  .openapi({ ref: "Attachment" });

export const _invoiceSchema = z.object({
  invoiceNumber: z.string().openapi({ example: "INV-2024-001" }),
  issueDate: z.string().date().openapi({ example: "2024-03-20" }),
  dueDate: z.string().date().nullish().openapi({ example: "2024-04-20" }),
  note: optionalNullishTextSchema.openapi({ example: "Thank you for your business" }),
  buyerReference: optionalNullishTextSchema.openapi({ example: "PO-2024-001" }),
  purchaseOrderReference: optionalNullishTextSchema.openapi({
    example: "PO-2024-001",
    description: "A reference to a related purchase order",
  }),
  salesOrderReference: optionalNullishTextSchema.openapi({ example: "SO-2024-001", description: "A reference to a related sales order." }),
  despatchReference: optionalNullishTextSchema.openapi({
    example: "DE-2024-001",
    description:
      "A reference to a related despatch advice document (e.g. packing slip)",
  }),
  seller: partySchema,
  buyer: partySchema,
  delivery: deliverySchema
    .nullish()
    .openapi({ description: "Optional delivery information." }),
  paymentMeans: z.array(paymentMeansSchema).nullish().openapi({
    description:
      "Optional payment information. For most invoices, this should be provided. For prepaid invoices, this could be omitted.",
  }),
  paymentTerms: z
    .object({
      note: z.string().openapi({ example: "Net 30" }),
    })
    .nullish(),
  lines: z.array(lineSchema).min(1),
  discounts: z
    .array(discountSchema)
    .nullish()
    .openapi({ description: "Optional global discounts" }),
  surcharges: z
    .array(surchargeSchema)
    .nullish()
    .openapi({ description: "Optional global surcharges" }),
  totals: totalsSchema.nullish(),
  vat: vatTotalsSchema.nullish(),
  attachments: z
    .array(attachmentSchema)
    .nullish()
    .openapi({ description: "Optional attachments to the invoice" }),
  currency: zCurrencies.default("EUR").openapi({
    example: "EUR",
    description: "The currency of the invoice. Defaults to EUR.",
    enum: CURRENCIES.map((currency) => currency.code),
  }),
});

export const invoiceSchema = _invoiceSchema.openapi({ ref: "Invoice" });

export const _sendInvoiceSchema = invoiceSchema.extend({
  issueDate: z.string().date().nullish().openapi({
    example: "2024-03-20",
    description: "If not provided, the issue date will be the current date.",
  }),
  dueDate: z.string().date().nullish().openapi({
    example: "2024-04-20",
    description:
      "If not provided, the due date will be 1 month from the issue date.",
  }),
  seller: partySchema.nullish().openapi({
    description:
      "If not provided, the seller will be the company that is sending the invoice.",
  }),
  vat: sendVatTotalsSchema.nullish().openapi({
    description:
      "If not provided, the VAT totals will be calculated from the document lines.",
  }),
});

export const sendInvoiceSchema = _sendInvoiceSchema.openapi({
  ref: "SendInvoice",
  title: "Invoice to send",
  description: "Invoice to send to a recipient",
});

export type Invoice = z.infer<typeof invoiceSchema>;
export type DocumentLine = z.infer<typeof lineSchema>;
export type Party = z.infer<typeof partySchema>;
export type PaymentMeans = z.infer<typeof paymentMeansSchema>;
export type PaymentTerms = z.infer<typeof invoiceSchema.shape.paymentTerms>;
export type Item = z.infer<typeof lineSchema>;
export type Vat = z.infer<typeof vatSchema>;
export type VatSubtotal = z.infer<typeof vatSubtotalSchema>;
export type Totals = z.infer<typeof totalsSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
