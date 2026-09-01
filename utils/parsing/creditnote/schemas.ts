import { z } from 'zod';
import "zod-openapi/extend";
import { baseCreditNoteSchema } from "@directory/documents/credit-note";
import { partySchema, sendVatTotalsSchema } from '../invoice/schemas';
import { countrySpecificSchema } from '../country-specific/schemas';

export * from "@directory/documents/credit-note";

export const _creditNoteSchema = baseCreditNoteSchema.extend({
  countrySpecific: countrySpecificSchema.nullish().openapi({ description: "Structured country-specific requirements. The FR variant is required for French regulated UBL, CII, and Factur-X document types." }),
});

export const creditNoteSchema = _creditNoteSchema.openapi({ ref: "CreditNote" });

export const _sendCreditNoteSchema = creditNoteSchema.extend({
  issueDate: z.string().date().nullish().openapi({ example: "2024-03-20", description: "If not provided, the issue date will be the current date." }),
  dueDate: z.string().date().nullish().openapi({ example: "2024-04-20", description: "If not provided, the due date will be 1 month from the issue date." }),
  seller: partySchema.nullish().openapi({ description: "If not provided, the seller will be the company that is sending the credit note." }),
  vat: sendVatTotalsSchema.nullish().openapi({ description: "If not provided, the VAT totals will be calculated from the document lines." }),
})

export const sendCreditNoteSchema = _sendCreditNoteSchema.openapi({ ref: "SendCreditNote", title: "Credit Note to send", description: "Credit note to send to a recipient" });

export type CreditNote = z.infer<typeof creditNoteSchema>;
