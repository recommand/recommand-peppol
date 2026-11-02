import { Server } from "@recommand/lib/api";
import { describeRoute } from "hono-openapi";
import { getImportFiles } from "@peppol/data/imports/files";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";
import { importSchema } from "@peppol/api/v2/schemas";
import { handle, jsonResponse, problemResponses, v2Access } from "@peppol/api/v2/shared";
import { loadImport, TAGS, toImport } from "./shared";

const server = new Server();

server.get(
  "/imports/:id",
  v2Access(),
  describeRoute({
    operationId: "getImport",
    summary: "Get an import",
    description: "An import with its status, its files and how many documents and failures it published so far.",
    tags: TAGS,
    responses: {
      200: jsonResponse("The import", importSchema),
      ...problemResponses(401, 403, 404, 410),
    },
  }),
  handle(async (c) => {
    const row = await loadImport(c, c.req.param("id")!, PEPPOL_PERMISSIONS.IMPORTS_READ);
    return c.json(toImport(row, await getImportFiles(row.id)));
  }),
);

export default server;
