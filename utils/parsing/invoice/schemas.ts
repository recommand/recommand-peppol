import { z } from "zod";
import "zod-openapi/extend";
import {
  baseInvoiceSchema,
  partySchema,
  vatTotalsSchema,
} from "@directory/documents/invoice";
import { countrySpecificSchema } from "../country-specific/schemas";

export * from "@directory/documents/invoice";

export const _invoiceSchema = baseInvoiceSchema.extend({
  countrySpecific: countrySpecificSchema.nullish().openapi({
    description:
      "Structured country-specific requirements. The FR variant is required for French regulated UBL, CII, and Factur-X document types.",
  }),
});

export const invoiceSchema = _invoiceSchema.openapi({ ref: "Invoice" });

export const sendVatTotalsSchema = z.union([
  vatTotalsSchema,
  z
    .object({
      exemptionReasonCode: z.string().nullish().openapi({
        description:
          "If the invoice is exempt from VAT, this (or exemptionReason) is required. The exemption reason code identifier must belong to the CEF VATEX code list	found [here](https://docs.peppol.eu/poacc/billing/3.0/2024-Q4/codelist/vatex/).",
      }),
      exemptionReason: z.string().nullish().openapi({
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
