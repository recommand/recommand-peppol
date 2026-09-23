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
    description: "Run a free-text search against the Peppol Directory and get back the participants that match, with the document types each is registered to receive. Use it to find a recipient's Peppol address when you only know who they are, then pass that address to the verify recipient endpoint. The Peppol Directory only lists participants that publish a directory entry, so a recipient that is reachable on the network can still be missing here. Returns a 503 when the directory itself cannot be reached.",
    summary: "Search Directory",
    tags: ["Recipients"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully searched directory", z.object({
        results: z.array(z.object({
            peppolAddress: z.string().openapi({
                description: "The participant's Peppol address, as `scheme:identifier`. Pass it as the recipient when sending.",
                example: "0208:1012081766",
            }),
            name: z.string().openapi({
                description: "The participant's name as published in its Peppol Directory entry. Empty when the entry carries no name.",
                example: "Recommand BV",
            }),
            supportedDocumentTypes: z.array(z.string()).openapi({
                description: "The full Peppol document type identifiers the participant is registered to receive.",
            }),
        })).openapi({ description: "The matching participants, in the order the Peppol Directory returned them." }),
    })),
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