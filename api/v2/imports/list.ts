import type { Context } from "hono";
import { Server } from "@recommand/lib/api";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import "zod-openapi/extend";
import { getFilesForImports } from "@peppol/data/imports/files";
import { listImports } from "@peppol/data/imports/imports";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";
import { importPageSchema, importStatusSchema, paginationQuerySchema } from "@peppol/api/v2/schemas";
import {
  ApiProblem,
  authorizeCompany,
  authorizeTeam,
  credentialTeamId,
  decodeCursor,
  handle,
  jsonResponse,
  page,
  problemResponses,
  v2Access,
  v2Validator,
} from "@peppol/api/v2/shared";
import { TAGS, toImport } from "./shared";

const server = new Server();

const MAX_COMPANIES = 50;

const querySchema = paginationQuerySchema.extend({
  teamId: z.string().optional().openapi({
    description:
      "The team whose imports to list. A credential bound to a team, such as an API key, lists its own team. A user session is not bound to one team: give teamId or companyId.",
  }),
  companyId: z
    .string()
    .optional()
    .transform((value, context) => {
      const ids = value ? [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))] : [];
      if (ids.length > MAX_COMPANIES) {
        context.addIssue({ code: "custom", message: `At most ${MAX_COMPANIES} companies.` });
        return z.NEVER;
      }
      return ids;
    })
    .openapi({ description: "Only the imports of these companies, comma-separated. All companies of the team when not given." }),
  statuses: z
    .string()
    .optional()
    .transform((value, context) => {
      const statuses = value ? value.split(",").map((status) => status.trim()).filter(Boolean) : [];
      const parsed = z.array(importStatusSchema).safeParse(statuses);
      if (!parsed.success) {
        context.addIssue({ code: "custom", message: "Unknown import status." });
        return z.NEVER;
      }
      return parsed.data;
    })
    .openapi({ description: "Only imports with one of these statuses, comma-separated, such as failed,partially_completed." }),
  createdFrom: z.string().datetime({ offset: true }).optional().openapi({ description: "Only imports created at or after this time." }),
  createdBefore: z.string().datetime({ offset: true }).optional().openapi({ description: "Only imports created before this time." }),
});

server.get(
  "/imports",
  v2Access(),
  describeRoute({
    operationId: "listImports",
    summary: "List imports",
    description:
      "The imports of a team or of some of its companies, newest first (in descending order of their ids, which follow the creation order), from the API and from email, also those without documents. Use it to find failed intake that no document shows.",
    tags: TAGS,
    responses: {
      200: jsonResponse("A page of imports", importPageSchema),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  v2Validator("query", querySchema),
  handle(async (c) => {
    const query = c.req.valid("query" as never) as z.infer<typeof querySchema>;
    const teamId = await authorizeScope(c, query.teamId, query.companyId);
    const filters = { ...query, cursor: undefined, limit: undefined };
    const afterId = decodeCursor(query.cursor, filters, z.string());
    const rows = await listImports({
      teamId,
      companyIds: query.companyId,
      statuses: query.statuses,
      createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
      createdBefore: query.createdBefore ? new Date(query.createdBefore) : undefined,
      afterId,
      limit: query.limit + 1,
    });
    const importFiles = await getFilesForImports(rows.map((row) => row.id));
    const filesOf = (id: string) => importFiles.filter((file) => file.importId === id);
    return c.json(
      page(
        rows,
        query.limit,
        (row) => toImport(row, filesOf(row.id)),
        (row) => row.id,
        filters,
      ),
    );
  }),
);

/** The team to list, after checking that the caller may read the imports of it and of each company. */
async function authorizeScope(c: Context, teamId: string | undefined, companyIds: string[]): Promise<string> {
  if (companyIds.length === 0) {
    const scope = teamId ?? credentialTeamId(c);
    if (!scope) {
      throw new ApiProblem(400, "invalid_request", "Give teamId or companyId: a user session is not bound to one team.");
    }
    await authorizeTeam(c, scope, PEPPOL_PERMISSIONS.IMPORTS_READ);
    return scope;
  }
  const teamIds = new Set<string>();
  for (const companyId of companyIds) {
    const { team } = await authorizeCompany(c, companyId, PEPPOL_PERMISSIONS.IMPORTS_READ);
    teamIds.add(team.id);
  }
  const [scope] = teamIds;
  if (teamIds.size > 1 || (teamId && teamId !== scope)) {
    throw new ApiProblem(400, "invalid_request", "The companies must belong to one team, the team in teamId when it is given.");
  }
  return scope;
}

export default server;
