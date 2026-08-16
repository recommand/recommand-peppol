import { z } from "zod";
import "zod-openapi/extend";
import { creditNoteDocumentType } from "@peppol/utils/type-repository/document-types/creditNote";
import { frenchInvoicingCdarDocumentType } from "@peppol/utils/type-repository/document-types/frenchInvoicingCdar";
import { invoiceDocumentType } from "@peppol/utils/type-repository/document-types/invoice";
import { messageLevelResponseDocumentType } from "@peppol/utils/type-repository/document-types/messageLevelResponse";
import { selfBillingCreditNoteDocumentType } from "@peppol/utils/type-repository/document-types/selfBillingCreditNote";
import { selfBillingInvoiceDocumentType } from "@peppol/utils/type-repository/document-types/selfBillingInvoice";

export const DocumentType = {
  INVOICE: "invoice",
  CREDIT_NOTE: "creditNote",
  SELF_BILLING_INVOICE: "selfBillingInvoice",
  SELF_BILLING_CREDIT_NOTE: "selfBillingCreditNote",
  MESSAGE_LEVEL_RESPONSE: "messageLevelResponse",
  FRENCH_INVOICING_CDAR: "frenchInvoicingCdar",
  XML: "xml",
} as const;

export const documentTypeSchema = z
  .enum([
    DocumentType.INVOICE,
    DocumentType.CREDIT_NOTE,
    DocumentType.SELF_BILLING_INVOICE,
    DocumentType.SELF_BILLING_CREDIT_NOTE,
    DocumentType.MESSAGE_LEVEL_RESPONSE,
    DocumentType.FRENCH_INVOICING_CDAR,
    DocumentType.XML,
  ])
  .openapi({
    description: "The type of document.",
    example: DocumentType.INVOICE,
  });

export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

const sendXmlSchema = z.string().openapi({
  ref: "XML",
  title: "XML",
  description: "XML document as a string",
});

/**
 * What each document type the send API accepts is called and how its payload is
 * parsed, taken from the document type registry so a request is validated
 * against the very schema the sending pipeline will preprocess it with. Raw XML
 * has no registry entry: it is passed through rather than parsed as a document.
 *
 * `translatableTitle` doubles as the OpenAPI title of the request variant, which
 * is what API reference tools label a `oneOf` entry by; without one they fall
 * back to the bare type ("object").
 *
 * Entries are imported one by one on purpose. The registry index types them as
 * `AnyDocumentType`, which widens every schema to `z.ZodSchema` and would silently
 * turn the parsed document into `any`.
 */
const documentRequestTypes = {
  [DocumentType.INVOICE]: invoiceDocumentType,
  [DocumentType.CREDIT_NOTE]: creditNoteDocumentType,
  [DocumentType.SELF_BILLING_INVOICE]: selfBillingInvoiceDocumentType,
  [DocumentType.SELF_BILLING_CREDIT_NOTE]: selfBillingCreditNoteDocumentType,
  [DocumentType.MESSAGE_LEVEL_RESPONSE]: messageLevelResponseDocumentType,
  [DocumentType.FRENCH_INVOICING_CDAR]: frenchInvoicingCdarDocumentType,
  [DocumentType.XML]: { sendSchema: sendXmlSchema, translatableTitle: "XML" },
} as const satisfies Record<
  DocumentType,
  { sendSchema: z.ZodTypeAny; translatableTitle: string }
>;

type DocumentRequestVariant<
  Base extends z.ZodRawShape,
  T extends DocumentType,
> = T extends DocumentType
  ? z.ZodObject<
      Base & {
        documentType: z.ZodLiteral<T>;
        document: (typeof documentRequestTypes)[T]["sendSchema"];
      }
    >
  : never;

/**
 * Pairs `base` with one variant per document type, discriminated on
 * `documentType`. Zod then validates the document against the single schema the
 * caller asked for, and the OpenAPI spec documents which body belongs to which
 * document type.
 */
export function documentRequestSchema<
  Base extends z.ZodRawShape,
  Types extends readonly DocumentType[],
>(base: Base, types: Types) {
  const variants = types.map((type) =>
    z
      .object({
        ...base,
        documentType: z.literal(type).openapi({
          description: "The type of document.",
          example: type,
        }),
        document: documentRequestTypes[type].sendSchema,
      })
      .openapi({ title: documentRequestTypes[type].translatableTitle }),
  ) as unknown as [
    DocumentRequestVariant<Base, Types[number]>,
    ...DocumentRequestVariant<Base, Types[number]>[],
  ];

  return z.discriminatedUnion("documentType", variants);
}

export const sendDocumentBaseShape = {
  recipient: z.string().nullable().openapi({
    description:
      "The Peppol address of the recipient. If null, the document will be sent via email only (requires `email.to`).",
    example: "0208:987654321",
  }),
  email: z
    .object({
      when: z
        .enum(["always", "on_peppol_failure"])
        .default("on_peppol_failure")
        .openapi({
          description: "When to send the email. If the provided Peppol recipient is null, email becomes the primary delivery method and emails are always sent.",
        }),
      to: z.array(z.string()).openapi({
        description: "The email addresses to send the document to.",
        example: ["support@recommand.eu"],
      }),
      subject: z.string().optional().openapi({
        description:
          "The subject of the email. If not provided, the subject will be autogenerated based on the document type.",
        example: "Invoice SI-001",
      }),
      htmlBody: z.string().optional().openapi({
        description:
          "The HTML body of the email. If not provided, the body will be autogenerated based on the document type.",
        example: "Dear customer, you can find your invoice attached.",
      }),
    })
    .optional()
    .openapi({
      ref: "Email",
      description:
        "Email delivery options. When Peppol recipient is provided, email is optional and you can choose to always send the email, or only when Peppol delivery fails. When Peppol recipient is null, email becomes the primary delivery method and `email.to` is required. Each sent email is counted towards your document quota.",
    }),
  pdfGeneration: z
    .object({
      enabled: z.boolean().default(false).openapi({
        description:
          "Whether to generate a PDF of the document and include it as an embedded attachment.",
      }),
      filename: z
        .string()
        .refine((name) => !name.includes("/") && !name.includes("\\"), {
          message: "Filename must not include path separators.",
        })
        .optional()
        .openapi({
          description:
            "Optional filename to use for the generated PDF attachment. Defaults to a filename derived from the document number (e.g. invoice-001.pdf).",
          example: "INV-2024-001.pdf",
        }),
    })
    .optional()
    .openapi({
      ref: "PDFGeneration",
      description:
        "Optionally generate a PDF of the document and include it as an embedded attachment (also included in email attachments when email sending is enabled). Not supported for message level responses, French Invoicing CDAR messages, or raw XML documents.",
    }),
  doctypeId: z.string().optional().openapi({
    description:
      "The document type identifier. For JSON documents this defaults to the standard Peppol BIS 3 UBL document type for the selected documentType. For raw XML documents it can be detected automatically where supported.",
    example:
      "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  }),
  processId: z.string().optional().openapi({
    description:
      "Optional process identifier override. It is detected automatically for supported JSON and XML document types.",
    example: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
  }),
} as const;

export const sendDocumentSchema = documentRequestSchema(
  sendDocumentBaseShape,
  documentTypeSchema.options,
);

export type SendDocument = z.infer<typeof sendDocumentSchema>;
