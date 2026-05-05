import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
    getInbox,
} from "@peppol/data/transmitted-documents";
import {
    describeErrorResponse,
    describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { transmittedDocumentResponse } from "./shared";

const server = new Server();

const getInboxRouteDescription = describeRoute({
    operationId: "getInbox",
    description: "List all unread incoming documents.",
    summary: "Inbox",
    tags: ["Documents"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved inbox documents", z.object({
            documents: z.array(transmittedDocumentResponse.omit({
                xml: true,
                parsed: true,
            })),
        })),
        ...describeErrorResponse(500, "Failed to fetch inbox documents"),
    },
});

const getInboxQuerySchema = z.object({
    companyId: z.string().optional().openapi({
        description: "Optionally filter documents by company ID",
    }),
});

type GetInboxContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { query: z.input<typeof getInboxQuerySchema> }, out: { query: z.infer<typeof getInboxQuerySchema> } }>;

const _getInboxMinimal = server.get(
    "/inbox",
    requireIntegrationSupportedTeamAccess(),
    getInboxRouteDescription,
    zodValidator("query", getInboxQuerySchema),
    _getInboxImplementation,
);

const _getInbox = server.get(
    "/:teamId/inbox",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("query", getInboxQuerySchema),
    zodValidator("param", z.object({
        teamId: z.string().openapi({
            description: "The ID of the team",
        })
    })),
    _getInboxImplementation,
);

async function _getInboxImplementation(c: GetInboxContext) {
    try {
        const { companyId } = c.req.valid("query");
        const documents = await getInbox(c.var.team.id, companyId);
        return c.json(actionSuccess({ documents }));
    } catch (error) {
        return c.json(actionFailure("Failed to fetch inbox documents"), 500);
    }
};

export type GetInbox = typeof _getInbox | typeof _getInboxMinimal;

export default server;