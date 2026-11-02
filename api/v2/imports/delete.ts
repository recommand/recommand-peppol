import { Server } from "@recommand/lib/api";
import { describeRoute } from "hono-openapi";
import { deleteImport, getImport, ImportInProgressError } from "@peppol/data/imports/imports";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";
import { ApiProblem, authorizeCompany, handle, problemResponses, v2Access } from "@peppol/api/v2/shared";
import { TAGS } from "./shared";

const server = new Server();

server.delete(
  "/imports/:id",
  v2Access(),
  describeRoute({
    operationId: "deleteImport",
    summary: "Delete an import",
    description:
      "Remove a finished import from the API. The documents it produced stay. An import that is queued or processing cannot be deleted yet. Deleting a deleted import succeeds.",
    tags: TAGS,
    responses: {
      204: { description: "The import is deleted" },
      ...problemResponses(401, 403, 404, 409),
    },
  }),
  handle(async (c) => {
    const row = await getImport(c.req.param("id")!);
    if (!row) {
      throw new ApiProblem(404, "not_found", "The import does not exist or is not accessible.");
    }
    await authorizeCompany(c, row.companyId, PEPPOL_PERMISSIONS.IMPORTS_WRITE, "import");
    try {
      await deleteImport(row);
    } catch (error) {
      if (error instanceof ImportInProgressError) {
        throw new ApiProblem(409, "import_in_progress", "The import is still being processed. Delete it when it has finished.", {
          context: { status: row.status },
        });
      }
      throw error;
    }
    return c.body(null, 204);
  }),
);

export default server;
