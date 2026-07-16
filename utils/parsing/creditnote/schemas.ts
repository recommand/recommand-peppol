import { z } from 'zod';
import "zod-openapi/extend";
import { attachmentSchema, deliverySchema, discountSchema, lineSchema, partySchema, paymentMeansSchema, sendVatTotalsSchema, surchargeSchema, totalsSchema, vatTotalsSchema } from '../invoice/schemas';
import { countrySpecificSchema } from '../country-specific/schemas';
import { CURRENCIES, zCurrencies } from '@peppol/utils/currencies';

const creditNoteInvoiceReferenceSchema = z.object({
  id: z.string().min(1).openapi({ example: "INV-2024-001", description: "The reference to the invoice that is being credited" }),
  issueDate: z.string().date().nullish().openapi({ example: "2024-03-20", description: "The issue date of the invoice that is being credited" }),
});

export const _creditNoteSchema = z.object({
  creditNoteNumber: z.string().openapi({ example: "CN-2024-001" }),
  issueDate: z.string().date().openapi({ example: "2024-03-20" }),
  note: z.string().nullish().openapi({ example: "Thank you for your business" }),
  countrySpecific: countrySpecificSchema.nullish().openapi({ description: "Structured country-specific requirements. The FR variant is required for French regulated UBL, CII, and Factur-X document types." }),
  buyerReference: z.string().nullish().openapi({ example: "PO-2024-001" }),
  invoiceReferences: z.array(creditNoteInvoiceReferenceSchema).default([]).openapi({ description: "References to one or more invoices that are being credited" }),
  purchaseOrderReference: z.string().nullish().openapi({ example: "PO-2024-001", description: "A reference to a related purchase order" }),
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
})

export const creditNoteSchema = _creditNoteSchema.openapi({ ref: "CreditNote" });

export const _sendCreditNoteSchema = creditNoteSchema.extend({
  issueDate: z.string().date().nullish().openapi({ example: "2024-03-20", description: "If not provided, the issue date will be the current date." }),
  dueDate: z.string().date().nullish().openapi({ example: "2024-04-20", description: "If not provided, the due date will be 1 month from the issue date." }),
  seller: partySchema.nullish().openapi({ description: "If not provided, the seller will be the company that is sending the credit note." }),
  vat: sendVatTotalsSchema.nullish().openapi({ description: "If not provided, the VAT totals will be calculated from the document lines." }),
})

export const sendCreditNoteSchema = _sendCreditNoteSchema.openapi({ ref: "SendCreditNote", title: "Credit Note to send", description: "Credit note to send to a recipient" });

export type CreditNote = z.infer<typeof creditNoteSchema>;
