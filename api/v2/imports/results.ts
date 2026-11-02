import { Server } from "@recommand/lib/api";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { listPublishedResults } from "@peppol/data/imports/results";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";
import { importResultPageSchema, paginationQuerySchema } from "@peppol/api/v2/schemas";
import {
  decodeCursor,
  handle,
  jsonResponse,
  page,
  problemResponses,
  v2Access,
  v2Validator,
} from "@peppol/api/v2/shared";
import { loadImport, TAGS, toImportResult } from "./shared";

const server = new Server();

server.get(
  "/imports/:id/results",
  v2Access(),
  describeRoute({
    operationId: "listImportResults",
    summary: "List the results of an import",
    description:
      "The documents and failures of an import, in the order they were published. A published result does not change. While the import is processing, a later request with the last nextCursor returns the results published since.",
    tags: TAGS,
    responses: {
      200: jsonResponse("A page of results", importResultPageSchema),
      ...problemResponses(400, 401, 403, 404, 410),
    },
  }),
  v2Validator("query", paginationQuerySchema),
  handle(async (c) => {
    const row = await loadImport(c, c.req.param("id")!, PEPPOL_PERMISSIONS.IMPORTS_READ);
    const query = c.req.valid("query" as never) as z.infer<typeof paginationQuerySchema>;
    const filters = { importId: row.id };
    const afterSequence = decodeCursor(query.cursor, filters, z.number().int().min(0).max(2_147_483_647));
    const rows = await listPublishedResults(row.id, { afterSequence, limit: query.limit + 1 });
    return c.json(page(rows, query.limit, toImportResult, (result) => result.sequence, filters));
  }),
);

export default server;
