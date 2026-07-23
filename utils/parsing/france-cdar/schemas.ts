import z from "zod";
import "zod-openapi/extend";
import { CURRENCIES, zCurrencies } from "@peppol/utils/currencies";

const franceCdarStatusCodeDescription = `French invoice lifecycle status.

| Value | Meaning |
| --- | --- |
| \`200\` | Submitted |
| \`201\` | Issued |
| \`202\` | Received |
| \`203\` | Made available |
| \`204\` | Taken in charge (processing started) |
| \`205\` | Approved |
| \`206\` | Partially approved |
| \`207\` | In dispute |
| \`208\` | Suspended |
| \`209\` | Completed |
| \`210\` | Refused |
| \`211\` | Payment sent |
| \`212\` | Collected (cashed) |
| \`213\` | Rejected |
| \`214\` | Validated or pre-validated ("Visée") |
| \`501\` | Inadmissible file |`;

const franceCdarPhaseDescription = `CDAR phase.

| Value | Meaning |
| --- | --- |
| \`23\` | Processing phase |
| \`305\` | Transmission phase |`;

const franceCdarBusinessProcessDescription = `Flow classification.

| Value | Meaning |
| --- | --- |
| \`REGULATED\` | Regulated French domestic e-invoicing |
| \`NON_REGULATED\` | Outside the regulated French e-invoicing perimeter |
| \`B2C\` | B2C sales e-reporting |
| \`B2CINT\` | International B2C sales e-reporting |
| \`B2BINT\` | International B2B sales e-reporting |
| \`OUTOFSCOPE\` | Outside the French e-invoicing and e-reporting reform |`;

const franceCdarRoleCodeDescription = `CDAR party role code (UNCL 3035).

| Value | Meaning |
| --- | --- |
| \`BY\` | Buyer |
| \`AB\` | Buyer's agent or representative |
| \`DL\` | Factor |
| \`SE\` | Seller |
| \`SR\` | Seller's agent |
| \`WK\` | Platform or dematerialisation operator |
| \`PE\` | Payee |
| \`PR\` | Payer |
| \`II\` | Invoicer (invoice issuer) |
| \`IV\` | Invoicee (party invoiced) |`;

const franceCdarInvoiceTypeCodeDescription = `Type of the referenced invoice (UNTDID 1001, restricted to the values allowed by BR-FR-04).

| Value | Meaning |
| --- | --- |
| \`380\` | Commercial invoice |
| \`389\` | Self-billed invoice |
| \`393\` | Factored invoice |
| \`501\` | Self-billed factored invoice |
| \`386\` | Advance payment invoice |
| \`500\` | Self-billed advance payment invoice |
| \`384\` | Corrective invoice |
| \`471\` | Self-billed corrective invoice |
| \`472\` | Factored corrective invoice |
| \`473\` | Self-billed factored corrective invoice |
| \`261\` | Self-billed credit note |
| \`262\` | Global rebate credit note |
| \`381\` | Credit note |
| \`396\` | Factored credit note |
| \`502\` | Self-billed factored credit note |
| \`503\` | Credit note for an advance payment invoice |`;

const franceCdarReasonCodeDescription = `Coded reason for the invoice lifecycle status.

| Value | Meaning |
| --- | --- |
| \`JUSTIF_ABS\` | Supporting document missing or insufficient |
| \`ROUTAGE_ERR\` | Routing error |
| \`AUTRE\` | Other reason; provide an explanation in \`reasonNote\` |
| \`COORD_BANC_ERR\` | Incorrect bank details |
| \`TX_TVA_ERR\` | Incorrect VAT rate |
| \`MONTANTTOTAL_ERR\` | Incorrect invoice total |
| \`CALCUL_ERR\` | Invoice calculation error |
| \`NON_CONFORME\` | Missing legal information |
| \`DOUBLON\` | Duplicate invoice |
| \`DEST_INC\` | Unknown recipient |
| \`DEST_ERR\` | Incorrect recipient |
| \`TRANSAC_INC\` | Unknown transaction |
| \`EMMET_INC\` | Unknown issuer |
| \`CONTRAT_TERM\` | Contract ended |
| \`DOUBLE_FACT\` | Supply or service already invoiced on another invoice |
| \`CMD_ERR\` | Incorrect or missing order number |
| \`ADR_ERR\` | Incorrect electronic invoicing address |
| \`SIRET_ERR\` | Incorrect or missing SIRET |
| \`CODE_ROUTAGE_ERR\` | Incorrect or missing routing code |
| \`REF_CT_ABSENT\` | Required contractual reference missing |
| \`REF_ERR\` | Incorrect reference |
| \`PU_ERR\` | Incorrect unit price |
| \`REM_ERR\` | Incorrect discount |
| \`QTE_ERR\` | Incorrect invoiced quantity |
| \`ART_ERR\` | Incorrect invoiced item |
| \`MODPAI_ERR\` | Incorrect payment terms |
| \`QUALITE_ERR\` | Incorrect quality of delivered item |
| \`LIVR_INCOMP\` | Incomplete or non-compliant delivery |
| \`REJ_SEMAN\` | Rejected because of a semantic error |
| \`REJ_UNI\` | Rejected by uniqueness control |
| \`REJ_COH\` | Rejected by data-consistency control |
| \`REJ_ADR\` | Rejected by addressing control |
| \`REJ_CONT_B2G\` | Rejected by B2G business controls |
| \`REJ_REF_PJ\` | Rejected because of an attachment-reference error |
| \`REJ_ASS_PJ\` | Rejected because of an attachment-association error |
| \`NON_TRANSMISE\` | Submitted but not transmitted because the recipient has no receiving platform |`;

export const franceCdarStatusCodeSchema = z.enum([
  "200", // Submitted
  "201", // Issued
  "202", // Received
  "203", // Made available
  "204", // Taken in charge (processing started)
  "205", // Approved
  "206", // Partially approved
  "207", // In dispute
  "208", // Suspended
  "209", // Completed
  "210", // Refused
  "211", // Payment sent
  "212", // Collected (cashed)
  "213", // Rejected
  "214", // Validated or pre-validated ("Visée")
  "501", // Inadmissible file
]).openapi({ description: franceCdarStatusCodeDescription });

export const franceCdarPhaseSchema = z.enum([
  "23", // Processing phase
  "305", // Transmission phase
]).openapi({ description: franceCdarPhaseDescription });

export const franceCdarBusinessProcessSchema = z.enum([
  "REGULATED", // Regulated French domestic e-invoicing
  "NON_REGULATED", // Outside the regulated French e-invoicing perimeter
  "B2C", // B2C sales e-reporting
  "B2CINT", // International B2C sales e-reporting
  "B2BINT", // International B2B sales e-reporting
  "OUTOFSCOPE", // Outside the French e-invoicing and e-reporting reform
]).openapi({ description: franceCdarBusinessProcessDescription });

export const franceCdarRoleCodeSchema = z.enum([
  "BY", // Buyer
  "AB", // Buyer's agent or representative
  "DL", // Factor
  "SE", // Seller
  "SR", // Seller's agent
  "WK", // Platform or dematerialisation operator
  "PE", // Payee
  "PR", // Payer
  "II", // Invoicer (invoice issuer)
  "IV", // Invoicee (party invoiced)
]).openapi({ description: franceCdarRoleCodeDescription });

export const franceCdarInvoiceTypeCodeSchema = z.enum([
  "380", // Commercial invoice
  "389", // Self-billed invoice
  "393", // Factored invoice
  "501", // Self-billed factored invoice
  "386", // Advance payment invoice
  "500", // Self-billed advance payment invoice
  "384", // Corrective invoice
  "471", // Self-billed corrective invoice
  "472", // Factored corrective invoice
  "473", // Self-billed factored corrective invoice
  "261", // Self-billed credit note
  "262", // Global rebate credit note
  "381", // Credit note
  "396", // Factored credit note
  "502", // Self-billed factored credit note
  "503", // Credit note for an advance payment invoice
]).openapi({ description: franceCdarInvoiceTypeCodeDescription });

export const franceCdarReasonCodeSchema = z.enum([
  "JUSTIF_ABS", // Supporting document missing or insufficient
  "ROUTAGE_ERR", // Routing error
  "AUTRE", // Other reason; requires a reasonNote explanation
  "COORD_BANC_ERR", // Incorrect bank details
  "TX_TVA_ERR", // Incorrect VAT rate
  "MONTANTTOTAL_ERR", // Incorrect invoice total
  "CALCUL_ERR", // Invoice calculation error
  "NON_CONFORME", // Missing legal information
  "DOUBLON", // Duplicate invoice
  "DEST_INC", // Unknown recipient
  "DEST_ERR", // Incorrect recipient
  "TRANSAC_INC", // Unknown transaction
  "EMMET_INC", // Unknown issuer (spelling used by the AFNOR code list)
  "CONTRAT_TERM", // Contract ended
  "DOUBLE_FACT", // Supply or service already invoiced
  "CMD_ERR", // Incorrect or missing order number
  "ADR_ERR", // Incorrect electronic invoicing address
  "SIRET_ERR", // Incorrect or missing SIRET
  "CODE_ROUTAGE_ERR", // Incorrect or missing routing code
  "REF_CT_ABSENT", // Required contractual reference missing
  "REF_ERR", // Incorrect reference
  "PU_ERR", // Incorrect unit price
  "REM_ERR", // Incorrect discount
  "QTE_ERR", // Incorrect invoiced quantity
  "ART_ERR", // Incorrect invoiced item
  "MODPAI_ERR", // Incorrect payment terms
  "QUALITE_ERR", // Incorrect quality of delivered item
  "LIVR_INCOMP", // Incomplete or non-compliant delivery
  "REJ_SEMAN", // Semantic validation rejection
  "REJ_UNI", // Uniqueness-control rejection
  "REJ_COH", // Data-consistency-control rejection
  "REJ_ADR", // Addressing-control rejection
  "REJ_CONT_B2G", // B2G business-control rejection
  "REJ_REF_PJ", // Attachment-reference rejection
  "REJ_ASS_PJ", // Attachment-association rejection
  "NON_TRANSMISE", // Recipient has no receiving platform
]).openapi({ description: franceCdarReasonCodeDescription });

const franceCdarAmountSchema = z
  .string()
  .regex(
    /^-?\d+(?:\.\d{1,6})?$/,
    "Expected a decimal amount with at most 6 decimal places"
  )
  .refine((amount) => amount.replace(".", "").length <= 19, {
    message:
      "Amount must not exceed 19 positions (the decimal point is excluded and the minus sign is included)",
  })
  .refine((amount) => /[1-9]/.test(amount), {
    message: "Collected amount must be positive or negative, not zero",
  });

const franceCdarVatPercentSchema = z
  .string()
  .regex(
    /^\d{1,3}(?:\.\d{1,2})?$/,
    "Expected a VAT percentage with up to 3 integer digits and 2 decimal places"
  );

function franceCdarNonBlankString(maxLength: number, field: string) {
  return z
    .string()
    .min(1, `${field} must not be empty`)
    .max(maxLength, `${field} must not exceed ${maxLength} characters`)
    .refine((value) => value.trim().length > 0, {
      message: `${field} must not be blank`,
    });
}

const franceCdarIdSchema = franceCdarNonBlankString(50, "CDAR ID");
const franceCdarInvoiceIdSchema = franceCdarNonBlankString(100, "Invoice ID");
const franceCdarLegalIdSchema = franceCdarNonBlankString(100, "Legal ID");
const franceCdarElectronicAddressSchema = franceCdarNonBlankString(
  100,
  "Electronic address"
);
const franceCdarIdentifierSchemeSchema = z
  .string()
  .regex(/^\d{4}$/, "Identifier scheme must be a four-digit code");
const franceCdarReasonSchema = franceCdarNonBlankString(250, "Reason");
const franceCdarReasonNoteSchema = franceCdarNonBlankString(
  2000,
  "Reason note"
);

export const franceCdarCollectedAmountSchema = z.object({
  amount: franceCdarAmountSchema.openapi({
    description:
      "Net collected amount (positive) or disbursed amount (negative), for status 212.",
    example: "12000.00",
  }),
  currency: zCurrencies.openapi({
    description: "ISO 4217 currency code of the collected amount.",
    example: "EUR",
    enum: CURRENCIES.map((currency) => currency.code),
  }),
  vatPercent: franceCdarVatPercentSchema.openapi({
    description: "VAT rate applicable to the collected amount.",
    example: "20.00",
  }),
});

const statusesRequiringReason = new Set([
  "206",
  "207",
  "208",
  "210",
  "213",
]);

const franceCdarTransmissionStatusCodes = new Set([
  "200",
  "201",
  "202",
  "203",
  "213",
  "501",
]);

export function getFranceCdarPhaseForStatus(
  statusCode: z.infer<typeof franceCdarStatusCodeSchema>
): z.infer<typeof franceCdarPhaseSchema> {
  return franceCdarTransmissionStatusCodes.has(statusCode) ? "305" : "23";
}

const franceCdarDateTimeSchema = z
  .string()
  .datetime({ local: true, precision: 0 })
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
    "Expected a local date-time in YYYY-MM-DDTHH:mm:ss format"
  );

const franceCdarIncomingIssueDateSchema = z.union([
  franceCdarDateTimeSchema,
  z.string().date(),
]);

const franceCdarObjectSchema = z.object({
  id: franceCdarIdSchema,
  issueDate: franceCdarIncomingIssueDateSchema.openapi({
    description:
      "Creation date and time of the CDAR, without a timezone and with second precision. Date-only values are accepted for incoming format-102 documents.",
    example: "2024-03-20T14:05:09",
  }),
  businessProcess: franceCdarBusinessProcessSchema.openapi({
    description: franceCdarBusinessProcessDescription,
    example: "REGULATED",
  }),
  phase: franceCdarPhaseSchema.openapi({
    description: franceCdarPhaseDescription,
    example: "23",
  }),
  senderRole: franceCdarRoleCodeSchema.openapi({
    description: `Role of the CDAR sender.

${franceCdarRoleCodeDescription}`,
    example: "WK",
  }),
  issuerRole: franceCdarRoleCodeSchema.openapi({
    description: `Role of the party that creates and issues the invoice lifecycle status. This is independent from the CDAR sender role.

${franceCdarRoleCodeDescription}`,
    example: "BY",
  }),
  issuerLegalId: franceCdarLegalIdSchema.optional().openapi({
    description:
      "Legal identifier of the party setting the status. Required when phase is 23; must be omitted when phase is 305.",
    example: "200000008",
  }),
  issuerLegalIdScheme: franceCdarIdentifierSchemeSchema.optional().openapi({
    description:
      "ISO 6523 ICD scheme of the party-setting-status legal identifier. Required together with issuerLegalId.",
    example: "0002",
  }),
  recipientRole: franceCdarRoleCodeSchema.openapi({
    description: `Role of the CDAR recipient.

${franceCdarRoleCodeDescription}`,
    example: "SE",
  }),
  recipientLegalId: franceCdarLegalIdSchema.optional().openapi({
    description: "Legal identifier of the CDAR recipient.",
    example: "200000008",
  }),
  recipientLegalIdScheme: franceCdarIdentifierSchemeSchema.optional().openapi({
    description:
      "ISO 6523 ICD scheme of the CDAR recipient legal identifier. Required together with recipientLegalId.",
    example: "0002",
  }),
  recipientElectronicAddress: franceCdarElectronicAddressSchema
    .optional()
    .openapi({
      description:
        "Electronic address of the CDAR recipient. Required when recipientRole is not WK.",
      example: "100000009",
    }),
  recipientElectronicAddressScheme: franceCdarIdentifierSchemeSchema
    .optional()
    .openapi({
      description:
        "Electronic Address Scheme (EAS) code of the CDAR recipient electronic address. Required together with recipientElectronicAddress.",
      example: "0225",
    }),
  statusCode: franceCdarStatusCodeSchema.openapi({
    description: franceCdarStatusCodeDescription,
    example: "200",
  }),
  statusDate: franceCdarIncomingIssueDateSchema.openapi({
    description:
      "Date and time at which the status itself was set, without a timezone and with second precision. This is distinct from issueDate, which is the creation date and time of the CDAR message. Date-only values are accepted for incoming format-102 documents.",
    example: "2024-03-20T14:05:09",
  }),
  invoiceId: franceCdarInvoiceIdSchema.openapi({
    description:
      "Number of the invoice this status relates to. For status 501, this is the filename of the inadmissible file.",
  }),
  invoiceTypeCode: franceCdarInvoiceTypeCodeSchema.optional().openapi({
    description: `Type of the referenced invoice. Required unless statusCode is 501, where the inadmissible file cannot be read.

${franceCdarInvoiceTypeCodeDescription}`,
    example: "380",
  }),
  invoiceIssueDate: z.string().date().optional().openapi({
    description:
      "Issue date of the referenced invoice. Required unless statusCode is 501.",
    example: "2024-03-15",
  }),
  sellerLegalId: franceCdarLegalIdSchema.optional().openapi({
    description:
      "Legal identifier (e.g. SIREN) of the invoice seller. Required unless statusCode is 501.",
    example: "123456789",
  }),
  sellerLegalIdScheme: franceCdarIdentifierSchemeSchema.optional().openapi({
    description:
      "ISO 6523 ICD scheme of the referenced invoice seller legal identifier. Required together with sellerLegalId.",
    example: "0002",
  }),
  reasonCode: franceCdarReasonCodeSchema.optional().openapi({
    description: franceCdarReasonCodeDescription,
  }),
  reason: franceCdarReasonSchema.optional().openapi({
    description:
      "Optional free-text status reason. This is distinct from the IncludedNote explanation required for reasonCode AUTRE.",
  }),
  reasonNote: franceCdarReasonNoteSchema.optional().openapi({
    description:
      "Free-text comment in the status detail IncludedNote. Required when reasonCode is AUTRE.",
    example: "The invoice needs manual review.",
  }),
  collectedAmounts: z.array(franceCdarCollectedAmountSchema).optional().openapi({
    description:
      "Collected amounts with VAT rates (TypeCode MEN). Required for status 212; at least one entry.",
  }),
});

function refineFranceCdar(
  data: Omit<
    z.infer<typeof franceCdarObjectSchema>,
    "id" | "issueDate" | "statusDate"
  > & {
    id?: string;
    issueDate?: string;
    statusDate?: string;
  },
  ctx: z.RefinementCtx,
  requireRecipientElectronicAddress = true
) {
  const identifierPairs = [
    ["issuerLegalId", "issuerLegalIdScheme"],
    ["recipientLegalId", "recipientLegalIdScheme"],
    ["recipientElectronicAddress", "recipientElectronicAddressScheme"],
    ["sellerLegalId", "sellerLegalIdScheme"],
  ] as const;

  for (const [valueField, schemeField] of identifierPairs) {
    const hasValue = Boolean(data[valueField]);
    const hasScheme = Boolean(data[schemeField]);
    if (hasValue !== hasScheme) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasValue ? schemeField : valueField],
        message: `${valueField} and ${schemeField} must be provided together`,
      });
    }
  }

  if (statusesRequiringReason.has(data.statusCode) && !data.reasonCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reasonCode"],
      message: `reasonCode is required for status ${data.statusCode}`,
    });
  }

  if (data.reasonCode === "AUTRE" && !data.reasonNote?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reasonNote"],
      message: "reasonNote is required when reasonCode is AUTRE",
    });
  }

  if (data.statusCode === "212") {
    if (!data.collectedAmounts?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collectedAmounts"],
        message: "collectedAmounts is required for status 212 (at least one MEN amount)",
      });
    }
  }

  if (data.statusCode !== "501") {
    if (!data.invoiceIssueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["invoiceIssueDate"],
        message: "invoiceIssueDate is required unless statusCode is 501",
      });
    }
    if (!data.sellerLegalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sellerLegalId"],
        message: "sellerLegalId is required unless statusCode is 501",
      });
    }
    if (!data.invoiceTypeCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["invoiceTypeCode"],
        message: "invoiceTypeCode is required unless statusCode is 501",
      });
    }
  }

  if (data.phase === "23" && !data.issuerLegalId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["issuerLegalId"],
      message: "issuerLegalId is required when phase is 23",
    });
  }

  if (data.phase === "305" && data.issuerLegalId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["issuerLegalId"],
      message: "issuerLegalId must be omitted when phase is 305",
    });
  }

  if (
    requireRecipientElectronicAddress &&
    data.recipientRole !== "WK" &&
    !data.recipientElectronicAddress
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipientElectronicAddress"],
      message: "recipientElectronicAddress is required when recipientRole is not WK",
    });
  }
}

export const franceCdarSchema = franceCdarObjectSchema
  .superRefine(refineFranceCdar)
  .openapi({
    ref: "FranceCdar",
    title: "French Invoicing CDAR",
    description:
      "French invoice lifecycle status using UN/CEFACT Cross Domain Acknowledgement and Response",
  });

export const sendFranceCdarSchema = franceCdarObjectSchema
  .omit({
    recipientElectronicAddress: true,
    recipientElectronicAddressScheme: true,
  })
  .extend({
    id: franceCdarIdSchema.optional().openapi({
      description: "The ID of the CDAR. If not provided, the ID will be autogenerated.",
    }),
    issueDate: franceCdarDateTimeSchema.optional().openapi({
      example: "2024-03-20T14:05:09",
      description:
        "If not provided, the issue date and time will be the current local date and time.",
    }),
    statusDate: franceCdarDateTimeSchema.optional().openapi({
      example: "2024-03-20T14:05:09",
      description:
        "Date and time at which the status was set. If not provided, the issue date and time of the CDAR is used.",
    }),
    phase: franceCdarPhaseSchema.optional().openapi({
      description: `${franceCdarPhaseDescription}

Defaults to \`305\` for statuses \`200\`, \`201\`, \`202\`, \`203\`, \`213\`, and \`501\`; otherwise defaults to \`23\`.`,
      example: "23",
    }),
  })
  .transform((data) => ({
    ...data,
    phase: data.phase ?? getFranceCdarPhaseForStatus(data.statusCode),
  }))
  .superRefine((data, ctx) => refineFranceCdar(data, ctx, false))
  .openapi({
    ref: "SendFranceCdar",
    title: "French Invoicing CDAR to send",
    description:
      "French invoice lifecycle status to send. The recipient electronic address is derived from the top-level Peppol recipient.",
  });

export type FranceCdarStatusCode = z.infer<typeof franceCdarStatusCodeSchema>;
export type FranceCdarPhase = z.infer<typeof franceCdarPhaseSchema>;
export type FranceCdarBusinessProcess = z.infer<typeof franceCdarBusinessProcessSchema>;
export type FranceCdarRoleCode = z.infer<typeof franceCdarRoleCodeSchema>;
export type FranceCdarReasonCode = z.infer<typeof franceCdarReasonCodeSchema>;
export type FranceCdarInvoiceTypeCode = z.infer<
  typeof franceCdarInvoiceTypeCodeSchema
>;
export type FranceCdarCollectedAmount = z.infer<typeof franceCdarCollectedAmountSchema>;
export type FranceCdar = z.infer<typeof franceCdarSchema>;
export type SendFranceCdar = z.infer<typeof sendFranceCdarSchema>;
