import { Server } from "@recommand/lib/api";
import type { Context } from "hono";
import { describeRoute } from "hono-openapi";
import { getFile, type ImportFile, readImportFile } from "@peppol/data/imports/files";
import { getImport } from "@peppol/data/imports/imports";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";
import { fileSchema } from "@peppol/api/v2/schemas";
import {
  ApiProblem,
  authorizeCompany,
  deletedProblem,
  handle,
  jsonResponse,
  problemResponses,
  v2Access,
} from "@peppol/api/v2/shared";
import { toFile } from "@peppol/api/v2/imports/shared";

// Files are read through the import that received them: access to the import's company
// and the permission to read imports. A file of a deleted import is no longer served: it
// answers 410, as the deleted import does.

const server = new Server();
const TAGS = ["Files"];

// A header value is a byte string, so the name goes in two forms (RFC 6266): an ASCII
// fallback for old clients, and the full name percent-encoded as UTF-8 in `filename*`.
function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const notFound = () => new ApiProblem(404, "not_found", "The file does not exist or is not accessible.");

async function loadFile(c: Context): Promise<ImportFile> {
  const file = await getFile(c.req.param("id")!);
  if (!file) {
    throw notFound();
  }
  await authorizeCompany(c, file.companyId, PEPPOL_PERMISSIONS.IMPORTS_READ, "file");
  const importRow = file.importId ? await getImport(file.importId) : null;
  if (!importRow) {
    throw notFound();
  }
  if (importRow.deletedAt) {
    throw deletedProblem("file", importRow);
  }
  return file;
}

server.get(
  "/files/:id",
  v2Access(),
  describeRoute({
    operationId: "getFile",
    summary: "Get a file",
    description: "The metadata of a file an import received or derived: its name, type, size, hash and where it came from.",
    tags: TAGS,
    responses: {
      200: jsonResponse("The file", fileSchema),
      ...problemResponses(401, 403, 404, 410),
    },
  }),
  handle(async (c) => c.json(toFile(await loadFile(c)))),
);

server.get(
  "/files/:id/content",
  v2Access(),
  describeRoute({
    operationId: "downloadFile",
    summary: "Download a file",
    description: "The bytes of a file, as they were received or derived.",
    tags: TAGS,
    responses: {
      200: {
        description: "The bytes of the file",
        content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
      },
      ...problemResponses(401, 403, 404, 410),
    },
  }),
  handle(async (c) => {
    const file = await loadFile(c);
    const etag = `"sha256-${file.sha256}"`;
    if (c.req.header("If-None-Match") === etag) {
      return c.body(null, 304, { ETag: etag });
    }
    const bytes = await readImportFile(file);
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": file.mediaType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition(file.filename),
      ETag: etag,
    });
  }),
);

export default server;
