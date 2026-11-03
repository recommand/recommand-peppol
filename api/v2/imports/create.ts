import { Server } from "@recommand/lib/api";
import { isS3Enabled } from "@core/lib/s3";
import { describeRoute } from "hono-openapi";
import { ulid } from "ulid";
import { z } from "zod";
import "zod-openapi/extend";
import { createSchema } from "zod-openapi";
import { getImportFiles, sha256Hex } from "@peppol/data/imports/files";
import { acceptImport, findImportByIdempotencyKey, type Import } from "@peppol/data/imports/imports";
import { kickImportWorker } from "@peppol/data/imports/worker";
import { getLabel } from "@peppol/data/labels";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";
import { importSchema, intakeDocumentTypeSchema } from "@peppol/api/v2/schemas";
import { documentDirectionSchema } from "@peppol/api/documents/shared";
import {
  ApiProblem,
  assertSameRequest,
  authorizeCompany,
  deletedProblem,
  handle,
  IDEMPOTENCY_KEY_PARAMETER,
  idempotencyExpiryHeader,
  idempotencyKey,
  jsonResponse,
  problemResponses,
  requestHash,
  requireTransactions,
  v2Access,
  zodIssues,
} from "@peppol/api/v2/shared";
import { isUniqueViolation } from "@peppol/utils/db-errors";
import { aiIntakeTypes } from "@peppol/utils/pipelines/intake/document-types";
import { detectFileKind, MEDIA_TYPES, xmlFormat, xmlText } from "@peppol/utils/pipelines/intake/file-kind";
import { MAX_FILE_SIZE, MAX_PDF_PAGES } from "@peppol/utils/pipelines/intake/config";
import { countPdfPages, PdfUnreadableError } from "@peppol/utils/pipelines/intake/pdf";
import { ACCEPTED_IMPORT_HEADERS, importActiveUntil, importLocation, TAGS, toImport } from "./shared";
import type { Context } from "hono";

const server = new Server();

const importRequestSchema = z
  .object({
    companyId: z.string().openapi({ description: "The company the documents are for." }),
    type: intakeDocumentTypeSchema.optional().openapi({
      description:
        "The document type the file must contain. A file recognised as another type fails with type_mismatch. Omit it to accept every supported type.",
    }),
    direction: documentDirectionSchema.default("incoming").openapi({
      description: "Whether the company received or issued the document. Only incoming is supported.",
    }),
    metadata: z
      .record(z.string().min(1).max(64), z.string().max(1024))
      .refine((metadata) => Object.keys(metadata).length <= 32, "At most 32 metadata keys are allowed.")
      .default({})
      .openapi({ description: "Your own keys and values for the import, at most 32." }),
    labelIds: z.array(z.string()).max(50).default([]).openapi({
      description: "Labels of the team to assign to every document of the import.",
    }),
  })
  .strict();

// The multipart body, written out in the document: the request part and the file part.
// Its type and direction refer to components the responses already publish.
const uploadBodySchema = createSchema(
  z.object({
    request: importRequestSchema.openapi({ description: "The import request, as JSON." }),
    file: z.string().openapi({ format: "binary", description: "The PDF or XML file, at most 25 MB." }),
  }),
  { schemaType: "input" },
).schema;

/** Answer a repeated command with the response that accepted it. A deleted import stays deleted. */
async function replay(c: Context, existing: Import, hash: string) {
  assertSameRequest(existing, hash);
  if (existing.deletedAt) {
    throw deletedProblem("import", existing);
  }
  const body = existing.idempotencyResponse ?? toImport(existing, await getImportFiles(existing.id));
  return c.json(body, 202, {
    Location: importLocation(existing.id),
    "Idempotency-Replayed": "true",
    ...idempotencyExpiryHeader(importActiveUntil(existing)),
  });
}

async function readUpload(c: Context) {
  if (!c.req.header("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
    throw new ApiProblem(415, "unsupported_media_type", "Send the request as multipart/form-data with a request part and a file part.");
  }
  const body = await c.req.parseBody();
  const part = body.request;
  let json: unknown;
  try {
    json = JSON.parse(typeof part === "string" ? part : part instanceof File ? await part.text() : "");
  } catch {
    throw new ApiProblem(400, "invalid_request", "The request part must be a JSON object.", {
      issues: [{ code: "invalid_json", message: "The request part is missing or not JSON.", pointer: "/request" }],
    });
  }
  const parsed = importRequestSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiProblem(400, "invalid_request", "The request part is not valid.", { issues: zodIssues(parsed.error) });
  }
  const file = body.file;
  if (!(file instanceof File)) {
    throw new ApiProblem(400, "invalid_request", "The file part is missing.", {
      issues: [{ code: "required", message: "Send the file as a part named file.", pointer: "/file" }],
    });
  }
  return { request: parsed.data, file };
}

/** The checks before acceptance: what the file is, and whether its type can be processed. */
async function checkFile(bytes: Buffer, type: string | undefined) {
  if (bytes.byteLength > MAX_FILE_SIZE) {
    throw new ApiProblem(413, "payload_too_large", `The file is larger than ${MAX_FILE_SIZE / 1024 / 1024} MB.`);
  }
  const kind = detectFileKind(bytes);
  if (!kind) {
    throw new ApiProblem(415, "unsupported_media_type", "The file is not a PDF or a well-formed XML document.");
  }
  if (kind === "pdf") {
    if (type && !aiIntakeTypes().some((candidate) => candidate.key === type)) {
      throw new ApiProblem(422, "extraction_unsupported", `Documents of type ${type} cannot be extracted from a PDF.`);
    }
    try {
      const pages = await countPdfPages(bytes);
      if (pages > MAX_PDF_PAGES) {
        throw new ApiProblem(422, "page_limit_exceeded", `The PDF has ${pages} pages; at most ${MAX_PDF_PAGES} are supported.`);
      }
    } catch (error) {
      // A PDF that cannot be opened is accepted: processing reports it as input_unreadable.
      if (!(error instanceof PdfUnreadableError)) throw error;
    }
  }
  return kind;
}

server.post(
  "/imports",
  v2Access(),
  describeRoute({
    operationId: "createImport",
    summary: "Upload a document",
    description:
      "Upload one PDF or XML file to be processed into documents in the background. XML in a supported format (UBL, CII), and a PDF with embedded XML (Factur-X, ZUGFeRD), is parsed. For a PDF without XML, the document type is recognised and the content extracted with AI. Each document appears as an incoming document of the company, the same as a document received over Peppol. Follow the import with GET /imports/{id} or the import events, and read its documents and failures at GET /imports/{id}/results.",
    tags: TAGS,
    parameters: [IDEMPOTENCY_KEY_PARAMETER],
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: uploadBodySchema as Record<string, unknown>,
          encoding: { request: { contentType: "application/json" } },
        },
      },
    },
    responses: {
      202: jsonResponse("The import was accepted. Its URL is in the Location header.", importSchema, ACCEPTED_IMPORT_HEADERS),
      ...problemResponses(400, 401, 403, 404, 409, 410, 413, 415, 422, 503),
    },
  }),
  handle(async (c) => {
    const key = idempotencyKey(c);
    const { request, file } = await readUpload(c);
    const { company, team } = await authorizeCompany(c, request.companyId, PEPPOL_PERMISSIONS.IMPORTS_WRITE);
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = requestHash({
      ...request,
      labelIds: [...request.labelIds].sort(),
      file: { filename: file.name, sha256: sha256Hex(bytes) },
    });
    const existing = key ? await findImportByIdempotencyKey(company.id, key) : null;
    if (existing) {
      return await replay(c, existing, hash);
    }

    await requireTransactions(team);
    if (request.direction !== "incoming") {
      throw new ApiProblem(422, "unsupported_direction", "Only incoming documents can be imported.");
    }
    const kind = await checkFile(bytes, request.type);
    for (const [index, labelId] of request.labelIds.entries()) {
      if (!(await getLabel(team.id, labelId))) {
        throw new ApiProblem(422, "label_not_found", `The label ${labelId} does not exist in the team.`, {
          issues: [{ code: "label_not_found", message: "Unknown label.", pointer: `/request/labelIds/${index}` }],
        });
      }
    }
    if (!isS3Enabled()) {
      throw new ApiProblem(503, "service_unavailable", "File storage is not available.");
    }

    const id = `imp_${ulid()}`;
    let row: Import;
    try {
      row = await acceptImport(
        {
          id,
          teamId: team.id,
          companyId: company.id,
          channel: "api",
          expectedType: request.type ?? null,
          direction: request.direction,
          metadata: request.metadata,
          labelIds: request.labelIds,
          source: { channel: "api", requestId: c.get("requestId" as never) as string },
          idempotencyKey: key,
          requestHash: hash,
        },
        [
          {
            filename: file.name || `document.${kind}`,
            mediaType: MEDIA_TYPES[kind],
            format: kind === "pdf" ? "pdf" : xmlFormat(xmlText(bytes)),
            bytes,
            provenance: { kind: "source" },
          },
        ],
        toImport,
      );
    } catch (error) {
      // The same key accepted by a request that ran at the same time: the unique index
      // made this insert wait for that commit, so its response is there to replay.
      const concurrent = key && isUniqueViolation(error) ? await findImportByIdempotencyKey(company.id, key) : null;
      if (concurrent) {
        return await replay(c, concurrent, hash);
      }
      throw error;
    }
    kickImportWorker();
    return c.json(row.idempotencyResponse, 202, {
      Location: importLocation(row.id),
      ...(key ? idempotencyExpiryHeader(importActiveUntil(row)) : {}),
    });
  }),
);

export default server;
