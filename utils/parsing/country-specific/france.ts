import { z } from "zod";
import "zod-openapi/extend";

const frenchBillingModeDescription = `Required only for French regulated UBL, CII, and Factur-X. Select the invoicing framework that matches the invoice.

| Mode | Description |
| --- | --- |
| \`B1\` | Goods invoice. |
| \`S1\` | Services invoice. |
| \`M1\` | Mixed invoice containing goods and services that are not ancillary to each other. |
| \`B2\` | Goods invoice that has already been paid. |
| \`S2\` | Services invoice that has already been paid. |
| \`M2\` | Mixed invoice that has already been paid. |
| \`S3\` | B2G subcontractor payment request with direct payment. |
| \`B4\` | Final goods invoice after an advance payment. |
| \`S4\` | Final services invoice after an advance payment. |
| \`M4\` | Final mixed invoice after an advance payment. |
| \`S5\` | Invoice submitted by a subcontractor for services rendered. |
| \`S6\` | Invoice submitted by a co-contractor for services rendered. |
| \`B7\` | Goods invoice that has already been e-reported and for which VAT has already been collected. |
| \`S7\` | Services invoice that has already been e-reported and for which VAT has already been collected. |
| \`B8\` | Multi-seller goods invoice. |
| \`S8\` | Multi-seller services invoice. |
| \`M8\` | Multi-seller mixed invoice whose individual invoices are not all goods invoices or all services invoices. |
`;

export const frenchBillingModeSchema = z.enum([
  "B1",
  "S1",
  "M1",
  "B2",
  "S2",
  "M2",
  "S3",
  "B4",
  "S4",
  "M4",
  "S5",
  "S6",
  "B7",
  "S7",
  "B8",
  "S8",
  "M8",
  "B9",
  "S9",
  "M9",
]).openapi({
  example: "S1",
});

export const frenchCountrySpecificSchema = z.object({
  country: z.literal("FR").openapi({
    description:
      "Identifies this as the French regulatory extension. This is independent from seller, buyer, delivery, and origin country codes.",
  }),
  billingMode: frenchBillingModeSchema.openapi({
    description: frenchBillingModeDescription,
  }),
  recoveryCostsNote: z.string().min(1).openapi({
    example: "Indemnite forfaitaire de 40 EUR pour frais de recouvrement.",
    description:
      "The mandatory French recovery-cost indemnity statement, written as an IncludedNote with subject code PMT.",
  }),
  latePaymentPenaltiesNote: z.string().min(1).openapi({
    example:
      "Penalites de retard exigibles au taux prevu dans les conditions generales de vente.",
    description:
      "The mandatory French late-payment penalties statement, written as an IncludedNote with subject code PMD.",
  }),
  earlyPaymentDiscountNote: z.string().min(1).openapi({
    example: "Aucun escompte accorde pour paiement anticipe.",
    description:
      "The mandatory French early-payment discount statement, written as an IncludedNote with subject code AAB. State either the offered discount terms or explicitly that no early-payment discount applies.",
  }),
}).openapi({
  ref: "FrenchCountrySpecificBilling",
  description:
    "Structured information required by French regulated UBL, CII, and Factur-X. The billing modes and notes follow AFNOR XP Z12-012.",
});

export type FrenchCountrySpecific = z.infer<typeof frenchCountrySpecificSchema>;
