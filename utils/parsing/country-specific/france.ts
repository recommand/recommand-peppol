import { z } from "zod";
import "zod-openapi/extend";
import {
  getFranceBillingProcessId,
  isFranceBillingProcessId,
} from "@peppol/utils/type-repository/document-formats/france-process";
import type { CountrySpecificProcessResolver } from "./process";

export { isFranceBillingProcessId } from "@peppol/utils/type-repository/document-formats/france-process";

const frenchBusinessProcessDescription = `Determines which French Peppol process the document is sent over. Defaults to \`REGULATED\`.

| Value | Description |
| --- | --- |
| \`REGULATED\` | Transaction inside the French e-invoicing perimeter. Sent over \`urn:peppol:france:billing:regulated\`. |
| \`NON_REGULATED\` | Transaction outside the French e-invoicing perimeter. Sent over \`urn:peppol:france:billing:non-regulated\`. |

The recipient must have registered the matching process for the document type in its SMP.`;

export const frenchBusinessProcessSchema = z.enum([
  "REGULATED", // Inside the French e-invoicing perimeter
  "NON_REGULATED", // Outside the French e-invoicing perimeter
]);

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
  businessProcess: frenchBusinessProcessSchema.optional().default("REGULATED").openapi({
    description: frenchBusinessProcessDescription,
    example: "REGULATED",
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

const frenchBusinessProcessCarrierSchema = z.object({
  countrySpecific: z.object({
    country: z.literal("FR"),
    businessProcess: frenchBusinessProcessSchema.optional(),
  }),
});

/**
 * Read the French business process off an unvalidated send request document.
 * Returns undefined for documents that are not French or that leave it unspecified,
 * so the regulated process stays the default.
 */
export function getFrenchBusinessProcess(
  document: unknown
): z.infer<typeof frenchBusinessProcessSchema> | undefined {
  const parsed = frenchBusinessProcessCarrierSchema.safeParse(document);
  return parsed.success ? parsed.data.countrySpecific.businessProcess : undefined;
}

/**
 * France exchanges the same document types over a regulated and a non-regulated
 * process, and the document decides which one. Claims only documents that travel over a
 * French billing process and state the business process they belong to.
 */
export const resolveFrenchProcessId: CountrySpecificProcessResolver = (
  processId,
  document
) => {
  if (!isFranceBillingProcessId(processId)) {
    return undefined;
  }
  const businessProcess = getFrenchBusinessProcess(document);
  return businessProcess ? getFranceBillingProcessId(businessProcess) : undefined;
};
