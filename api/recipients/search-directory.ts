import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
    describeErrorResponse,
    describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { searchPeppolDirectory } from "@peppol/data/peppol-directory";
import { getTeamExtension } from "@peppol/data/teams";

const server = new Server();

const searchDirectoryRouteDescription = describeRoute({
    operationId: "searchDirectory",
    description: "Search for recipients in the Peppol Directory",
    summary: "Search Directory",
    tags: ["Recipients"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully searched directory", z.object({ results: z.array(z.object({ peppolAddress: z.string(), name: z.string(), supportedDocumentTypes: z.array(z.string()) })) })),
        ...describeErrorResponse(503, "Peppol directory is currently unavailable"),
    },
});

const searchDirectoryJsonBodySchema = z.object({
    query: z.string().openapi({ description: "The search query to find recipients.", example: "Company Name" }),
});

type SearchDirectoryContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { json: z.input<typeof searchDirectoryJsonBodySchema> }, out: { json: z.infer<typeof searchDirectoryJsonBodySchema> } }>;

const _searchDirectoryMinimal = server.post(
    "/search-peppol-directory",
    requireIntegrationSupportedTeamAccess(),
    searchDirectoryRouteDescription,
    zodValidator("json", searchDirectoryJsonBodySchema),
    _searchDirectoryImplementation,
);

const _searchDirectory = server.post(
    "/searchPeppolDirectory",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("json", searchDirectoryJsonBodySchema),
    _searchDirectoryImplementation,
);

async function _searchDirectoryImplementation(c: SearchDirectoryContext) {
    try {
        const { query } = c.req.valid("json");
        const teamExtension = await getTeamExtension(c.var.team.id);
        const results = await searchPeppolDirectory({ query, useTestNetwork: teamExtension?.useTestNetwork ?? false });
        return c.json(actionSuccess({ results }));
    } catch (error) {
        return c.json(actionFailure("Peppol directory is currently unavailable"), 503);
    }
}

export type SearchDirectory = typeof _searchDirectory | typeof _searchDirectoryMinimal;

export default server;