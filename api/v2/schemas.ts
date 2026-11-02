import { z } from "zod";
import "zod-openapi/extend";
import { importStatuses, inboundAddressStatuses } from "@peppol/types/intake";
import { intakeTypeKeys } from "@peppol/utils/pipelines/intake/document-types";

// The models of the v2 intake operations. Each object is a named component, so a
// generated client gets a type with a real name for it.

export const issueSchema = z
  .object({
    code: z.string().openapi({ description: "A stable code for the issue." }),
    message: z.string().openapi({ description: "What is wrong, for a person to read." }),
    pointer: z.string().optional().openapi({ description: "A JSON Pointer to the value the issue is about." }),
  })
  .openapi({ ref: "Issue" });

export const problemSchema = z
  .object({
    type: z.string().openapi({ description: "A URI that identifies the kind of problem." }),
    title: z.string().openapi({ description: "A short summary of the kind of problem." }),
    status: z.number().int().openapi({ description: "The HTTP status of the response." }),
    detail: z.string().openapi({ description: "What went wrong with this request." }),
    code: z.string().openapi({ description: "A stable code for the kind of problem." }),
    requestId: z.string().openapi({ description: "The id of the request, also in the X-Request-Id header." }),
    issues: z.array(issueSchema).optional(),
    context: z.record(z.unknown()).optional().openapi({ description: "Details that depend on the code." }),
  })
  .openapi({
    ref: "ProblemDetails",
    description: "An error, as RFC 9457 Problem Details.",
  });

export const failureSchema = z
  .object({
    code: z.string().openapi({
      description:
        "Why processing failed: input_unreadable, file_unreadable, file_too_large, page_limit_exceeded, input_rejected, unsupported_format, unsupported_document_type, classification_uncertain, type_mismatch, multiple_messages_detected, extraction_invalid, insufficient_evidence or processing_unavailable. Handle unknown codes.",
    }),
    message: z.string(),
    issues: z.array(issueSchema).optional(),
    context: z.record(z.unknown()).optional().openapi({
      description: "Details that depend on the code, such as `detectedType` for type_mismatch.",
    }),
  })
  .openapi({ ref: "Failure", description: "Why an import or a result produced no document." });

export const intakeDocumentTypeSchema = z
  .enum(intakeTypeKeys() as [string, ...string[]])
  .openapi({ ref: "IntakeDocumentType", description: "A document type that intake can produce." });

export const fileReferenceSchema = z
  .object({
    id: z.string(),
    filename: z.string(),
    mediaType: z.string(),
    size: z.number().int().openapi({ description: "The size in bytes." }),
  })
  .openapi({ ref: "FileReference", description: "A file. Its metadata is at GET /files/{id}." });

export const pageRangeSchema = z
  .object({
    type: z.literal("pages"),
    from: z.number().int().openapi({ description: "The first page, counting from 1." }),
    to: z.number().int().openapi({ description: "The last page, included." }),
  })
  .openapi({ ref: "PageRange" });

export const sourceLocationSchema = z
  .object({
    fileId: z.string(),
    role: z.enum(["primary", "supporting"]).openapi({
      description:
        "primary: the file the result was read from. supporting: another representation of the same message, such as the PDF view of an XML invoice or the XML embedded in a PDF.",
    }),
    range: pageRangeSchema.nullable().openapi({ description: "The part of the file; null for the whole file." }),
  })
  .openapi({ ref: "SourceLocation" });

export const fileProvenanceInputSchema = z
  .object({ fileId: z.string(), range: pageRangeSchema.nullable() })
  .openapi({ ref: "FileProvenanceInput" });

export const fileProvenanceSchema = z
  .object({
    kind: z.enum(["source", "derived"]).openapi({
      description: "source: received as it is. derived: obtained from other files, such as the XML embedded in a PDF.",
    }),
    operation: z.literal("unwrap").optional().openapi({ description: "How a derived file was obtained." }),
    inputs: z.array(fileProvenanceInputSchema).optional().openapi({ description: "The files a derived file was obtained from." }),
  })
  .openapi({ ref: "FileProvenance" });

export const fileSchema = z
  .object({
    id: z.string(),
    companyId: z.string(),
    filename: z.string(),
    mediaType: z.string(),
    size: z.number().int().openapi({ description: "The size in bytes." }),
    sha256: z.string().openapi({ description: "The SHA-256 of the bytes, in lowercase hexadecimal." }),
    format: z.string().nullable().openapi({ description: "The syntax of the bytes: pdf, ubl, cii, xml or mime." }),
    profileId: z.string().nullable(),
    provenance: fileProvenanceSchema,
    createdAt: z.string().openapi({ description: "When the file was stored." }),
    retainUntil: z.string().nullable().openapi({ description: "Null: no expiry is scheduled." }),
  })
  .openapi({ ref: "File", description: "Immutable bytes that an import received or derived." });

export const importStatusSchema = z.enum(importStatuses).openapi({
  ref: "ImportStatus",
  description:
    "queued: accepted, not started. processing: running. completed: every relevant part produced a document. partially_completed: some documents and some failures. failed: no document. ignored: nothing relevant was found.",
});

export const resultCountsSchema = z
  .object({
    documents: z.number().int().openapi({ description: "Published results with a document." }),
    failed: z.number().int().openapi({ description: "Published results with a failure." }),
  })
  .openapi({ ref: "ImportResultCounts" });

export const emailAuthenticationSchema = z
  .object({
    spf: z.string().nullable().openapi({ description: "The SPF result, such as pass or fail, when known." }),
    dkim: z.string().nullable().openapi({ description: "The DKIM result, such as pass or fail, when known." }),
  })
  .openapi({ ref: "EmailAuthentication" });

export const apiImportSourceSchema = z
  .object({
    channel: z.literal("api"),
    recordedAt: z.string().openapi({ description: "When Recommand registered the import." }),
    requestId: z.string().nullable().openapi({ description: "The request that created the import." }),
  })
  .openapi({ ref: "ApiImportSource", description: "An import uploaded through the API." });

export const emailImportSourceSchema = z
  .object({
    channel: z.literal("email"),
    recordedAt: z.string().openapi({ description: "When Recommand registered the import." }),
    from: z.string().nullable().openapi({ description: "The sender." }),
    to: z.string().openapi({ description: "The receiving address." }),
    subject: z.string().nullable(),
    receivedAt: z.string().nullable().openapi({ description: "When the email was received, as its Date header says; null without one." }),
    authentication: emailAuthenticationSchema,
  })
  .openapi({ ref: "EmailImportSource", description: "An import received by email." });

export const importSourceSchema = z
  .discriminatedUnion("channel", [apiImportSourceSchema, emailImportSourceSchema])
  .openapi({ ref: "ImportSource", description: "How the import arrived: by API request or by email." });

export const importSchema = z
  .object({
    id: z.string(),
    revision: z.number().int().openapi({ description: "Increases with every change of the import." }),
    companyId: z.string(),
    status: importStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    source: importSourceSchema,
    files: z.array(fileReferenceSchema).openapi({ description: "The files the import received or derived." }),
    resultCounts: resultCountsSchema,
    error: failureSchema.nullable().openapi({ description: "A failure of the whole input, such as input_unreadable." }),
  })
  .openapi({
    ref: "Import",
    description: "Files to process into documents. Its results are at GET /imports/{id}/results.",
  });

export const importResultSchema = z
  .object({
    id: z.string(),
    locations: z.array(sourceLocationSchema),
    documentId: z.string().nullable().openapi({ description: "The document the result produced." }),
    error: failureSchema.nullable().openapi({ description: "Why the result produced no document." }),
  })
  .openapi({ ref: "ImportResult", description: "One business document of an import, or one failure." });

export const inboundAddressStatusSchema = z
  .enum([...inboundAddressStatuses, "disabled"] as [string, ...string[]])
  .openapi({ ref: "InboundAddressStatus", description: "active: receives email. disabled: does not receive email." });

export const inboundAddressSchema = z
  .object({
    id: z.string(),
    revision: z.number().int(),
    companyId: z.string(),
    address: z.string().openapi({ description: "The email address. It never changes." }),
    enabled: z.boolean(),
    status: inboundAddressStatusSchema,
    acceptedTypes: z.array(intakeDocumentTypeSchema).nullable().openapi({
      description: "The document types the address accepts; null accepts every supported type.",
    }),
    error: failureSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi({
    ref: "InboundAddress",
    description: "An email address that turns the documents attached to the emails it receives into imports.",
  });

const pageOf = <T extends z.ZodTypeAny>(item: T, ref: string) =>
  z
    .object({
      data: z.array(item),
      nextCursor: z.string().nullable().openapi({ description: "The cursor of the next page; null on the last page." }),
    })
    .openapi({ ref });

export const importPageSchema = pageOf(importSchema, "ImportPage");
export const importResultPageSchema = pageOf(importResultSchema, "ImportResultPage");
export const inboundAddressPageSchema = pageOf(inboundAddressSchema, "InboundAddressPage");

export const paginationQuerySchema = z.object({
  cursor: z.string().optional().openapi({ description: "The nextCursor of the previous page. Omit it for the first page." }),
  limit: z.coerce.number().int().min(1).max(100).default(50).openapi({ description: "Items per page, at most 100." }),
});
