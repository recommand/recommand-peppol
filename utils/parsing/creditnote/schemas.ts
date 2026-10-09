import { z } from "zod";
import "zod-openapi/extend";
import {
  attachmentSchema,
  deliverySchema,
  discountSchema,
  lineSchema,
  partySchema,
  paymentMeansSchema,
  sendVatTotalsSchema,
  surchargeSchema,
  totalsSchema,
  vatTotalsSchema,
} from "../invoice/schemas";
import { CURRENCIES, zCurrencies } from "@peppol/utils/currencies";
import { countrySpecificSchema } from "../country-specific/schemas";

export const creditNoteInvoiceReferenceSchema = z.object({
  id: z.string().min(1).openapi({ example: "INV-2024-001", description: "The reference to the invoice that is being credited" }),
  issueDate: z.string().date().nullish().openapi({ example: "2024-03-20", description: "The issue date of the invoice that is being credited" }),
});

export const baseCreditNoteSchema = z.object({
  creditNoteNumber: z.string().openapi({ example: "CN-2024-001" }),
  issueDate: z.string().date().openapi({ example: "2024-03-20" }),
  dueDate: z.string().date().nullish().openapi({ example: "2024-04-20", description: "The date the credited amount is due (BT-9). Optional: when left out, the credit note states no due date. In CII, including Factur-X, it is the payment due date of the payment terms; in UBL it is stated on the first payment means, so a UBL credit note without `paymentMeans` does not carry it." }),
  note: z.string().nullish().openapi({ example: "Thank you for your business" }),
  buyerReference: z.string().nullish().openapi({ example: "CC-4120", description: "A reference the buyer asked you to put on the credit note so they can route it internally (BT-10). If neither this nor `purchaseOrderReference` is provided, the credit note number is used. For a German public authority addressed by its Leitweg-ID (recipient scheme `0204`), this must be that Leitweg-ID: it is filled in when left out, and a different value is refused." }),
  invoiceReferences: z.array(creditNoteInvoiceReferenceSchema).default([]).openapi({ description: "References to one or more invoices that are being credited. A French regulated credit note (`countrySpecific.country` `FR`) needs at least one reference with its `issueDate`." }),
  purchaseOrderReference: z.string().nullish().openapi({ example: "4500012345", description: "The buyer's purchase order number (BT-13), written to the order reference." }),
  salesOrderReference: z.string().nullish().openapi({ example: "SO-2024-001", description: "A reference to a related sales order." }),
  despatchReference: z.string().nullish().openapi({ example: "DE-2024-001", description: "A reference to a related despatch advice document (e.g. packing slip)" }),
  seller: partySchema,
  buyer: partySchema,
  delivery: deliverySchema.nullish().openapi({ description: "Optional delivery information." }),
  paymentMeans: z.array(paymentMeansSchema).nullish(),
  paymentTerms: z.object({
    note: z.string().openapi({ example: "Net 30" }),
  }).nullish(),
  lines: z.array(lineSchema).min(1),
  discounts: z.array(discountSchema).nullish().openapi({ description: "Optional global discounts" }),
  surcharges: z.array(surchargeSchema).nullish().openapi({ description: "Optional global surcharges" }),
  totals: totalsSchema.nullish(),
  vat: vatTotalsSchema.nullish(),
  attachments: z.array(attachmentSchema).nullish().openapi({ description: "Optional attachments to the credit note" }),
  currency: zCurrencies.default("EUR").openapi({ example: "EUR", description: "The currency of the credit note. Defaults to EUR.", enum: CURRENCIES.map((currency) => currency.code) }),
});

export const _creditNoteSchema = baseCreditNoteSchema.extend({
  countrySpecific: countrySpecificSchema.nullish().openapi({ description: "Structured country-specific requirements. The FR variant is required for French regulated UBL, CII, and Factur-X document types." }),
});

export const creditNoteSchema = _creditNoteSchema.openapi({ ref: "CreditNote" });

export const _sendCreditNoteSchema = creditNoteSchema.extend({
  issueDate: z.string().date().nullish().openapi({ example: "2024-03-20", description: "If not provided, the issue date will be the current date." }),
  seller: partySchema.nullish().openapi({ description: "If not provided, the seller will be the company that is sending the credit note." }),
  vat: sendVatTotalsSchema.nullish().openapi({ description: "If not provided, the VAT totals will be calculated from the document lines." }),
})

export const sendCreditNoteSchema = _sendCreditNoteSchema.openapi({ ref: "SendCreditNote", title: "Credit Note to send", description: "Credit note to send to a recipient" });

export type CreditNote = z.infer<typeof creditNoteSchema>;
