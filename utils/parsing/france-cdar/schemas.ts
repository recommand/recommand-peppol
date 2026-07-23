import z from "zod";
import "zod-openapi/extend";

const franceCdarStatusCodeDescription = `French invoice lifecycle status (MDT-105).

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

const franceCdarPhaseDescription = `CDAR phase (MDT-77).

| Value | Meaning |
| --- | --- |
| \`23\` | Processing phase |
| \`305\` | Transmission phase |`;

const franceCdarBusinessProcessDescription = `Flow classification (MDT-2).

| Value | Meaning |
| --- | --- |
| \`REGULATED\` | Regulated French domestic e-invoicing |
| \`NON_REGULATED\` | Outside the regulated French e-invoicing perimeter |
| \`B2C\` | B2C sales e-reporting |
| \`B2CINT\` | International B2C |
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
| \`IV\` | Invoicee (party invoiced) |
| \`DFH\` | French Public Billing Portal (PPF) |`;

const franceCdarReasonCodeDescription = `Coded reason for the invoice lifecycle status (MDT-113).

A reason code is required for statuses \`206\`, \`207\`, \`208\`, \`210\`, \`213\`, and \`501\`. Other statuses may also carry a reason code when applicable. The allowed codes are status-dependent; see the AFNOR "Tableau des motifs de STATUTS".

| Value | Meaning |
| --- | --- |
| \`JUSTIF_ABS\` | Supporting document missing or insufficient |
| \`ROUTAGE_ERR\` | Routing error |
| \`AUTRE\` | Other reason; provide an explanation in \`reason\` |
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
  "B2CINT", // International B2C
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
  "DFH", // French Public Billing Portal (PPF)
]).openapi({ description: franceCdarRoleCodeDescription });

export const franceCdarReasonCodeSchema = z.enum([
  "JUSTIF_ABS", // Supporting document missing or insufficient
  "ROUTAGE_ERR", // Routing error
  "AUTRE", // Other reason; requires a free-text reason
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

export const franceCdarCollectedAmountSchema = z.object({
  amount: z.string().openapi({
    description: "Collected amount including tax (MDT-215), for status 212.",
    example: "12000.00",
  }),
  vatPercent: z.string().openapi({
    description: "VAT rate applicable to the collected amount (MDT-224).",
    example: "20.00",
  }),
});

const statusesRequiringReason = new Set([
  "206",
  "207",
  "208",
  "210",
  "213",
  "501",
]);

const franceCdarObjectSchema = z.object({
  id: z.string(),
  issueDate: z.string().date().openapi({ example: "2024-03-20" }),
  businessProcess: franceCdarBusinessProcessSchema.openapi({
    description: franceCdarBusinessProcessDescription,
    example: "REGULATED",
  }),
  phase: franceCdarPhaseSchema.openapi({
    description: franceCdarPhaseDescription,
    example: "23",
  }),
  senderRole: franceCdarRoleCodeSchema.openapi({
    description: `Role of the CDAR sender (MDT-21).

${franceCdarRoleCodeDescription}`,
    example: "BY",
  }),
  issuerLegalId: z.string().optional().openapi({
    description:
      "Legal identifier of the party setting the status (MDT-38). Required when phase is 23; must be omitted when phase is 305.",
    example: "200000008",
  }),
  recipientRole: franceCdarRoleCodeSchema.openapi({
    description: `Role of the CDAR recipient (MDT-59).

${franceCdarRoleCodeDescription}`,
    example: "SE",
  }),
  recipientLegalId: z.string().optional().openapi({
    description: "Legal identifier of the CDAR recipient (MDT-57).",
    example: "100000009",
  }),
  recipientElectronicAddress: z.string().optional().openapi({
    description:
      "Electronic address of the CDAR recipient (MDT-73). Required when recipientRole is not WK or DFH.",
    example: "100000009_STATUTS",
  }),
  statusCode: franceCdarStatusCodeSchema.openapi({
    description: franceCdarStatusCodeDescription,
    example: "200",
  }),
  invoiceId: z.string().openapi({
    description:
      "Number of the invoice this status relates to (MDT-87). For status 501, this is the filename of the inadmissible file.",
  }),
  invoiceIssueDate: z.string().date().optional().openapi({
    description:
      "Issue date of the referenced invoice (MDG-35). Required unless statusCode is 501.",
    example: "2024-03-15",
  }),
  sellerLegalId: z.string().optional().openapi({
    description:
      "Legal identifier (e.g. SIREN) of the invoice seller (MDT-129). Required unless statusCode is 501.",
    example: "123456789",
  }),
  reasonCode: franceCdarReasonCodeSchema.optional().openapi({
    description: franceCdarReasonCodeDescription,
  }),
  reason: z.string().optional().openapi({
    description:
      "Optional free-text explanation of the status reason (MDT-114). It is not generally required together with reasonCode, but must be provided when reasonCode is AUTRE.",
  }),
  collectedAmounts: z.array(franceCdarCollectedAmountSchema).optional().openapi({
    description:
      "Collected amounts with VAT rates (MDG-43, TypeCode MEN). Required for status 212; at least one entry.",
  }),
});

function refineFranceCdar(
  data: Omit<z.infer<typeof franceCdarObjectSchema>, "id" | "issueDate"> & {
    id?: string;
    issueDate?: string;
  },
  ctx: z.RefinementCtx,
  requireRecipientElectronicAddress = true
) {
  if (statusesRequiringReason.has(data.statusCode) && !data.reasonCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reasonCode"],
      message: `reasonCode is required for status ${data.statusCode}`,
    });
  }

  if (data.reasonCode === "AUTRE" && !data.reason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason"],
      message: "reason is required when reasonCode is AUTRE",
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
    data.recipientRole !== "DFH" &&
    !data.recipientElectronicAddress
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipientElectronicAddress"],
      message:
        "recipientElectronicAddress is required when recipientRole is not WK or DFH",
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
  })
  .extend({
    id: z.string().optional().openapi({
      description: "The ID of the CDAR. If not provided, the ID will be autogenerated.",
    }),
    issueDate: z.string().date().optional().openapi({
      example: "2024-03-20",
      description: "If not provided, the issue date will be the current date.",
    }),
    phase: franceCdarPhaseSchema.default("23").openapi({
      description: `${franceCdarPhaseDescription}

Defaults to \`23\`.`,
      example: "23",
    }),
  })
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
export type FranceCdarCollectedAmount = z.infer<typeof franceCdarCollectedAmountSchema>;
export type FranceCdar = z.infer<typeof franceCdarSchema>;
export type SendFranceCdar = z.infer<typeof sendFranceCdarSchema>;
