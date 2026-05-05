import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { type CompanyAccessContext, requireIntegrationAccess } from "@peppol/utils/auth-middleware";
import { integrationResponse } from "./shared";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { getIntegration } from "@peppol/data/integrations";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";

const server = new Server();

const getIntegrationRouteDescription = describeRoute({
    operationId: "getIntegration",
    description: "Get a specific activated integration by ID",
    summary: "Get Integration",
    tags: ["Integrations"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved integration", z.object({ integration: integrationResponse })),
        ...describeErrorResponse(404, "Integration not found"),
        ...describeErrorResponse(500, "Failed to fetch integration"),
    },
});

const getIntegrationParamSchema = z.object({
    integrationId: z.string().openapi({
        description: "The ID of the integration to retrieve",
    }),
});

const getIntegrationParamSchemaWithTeamId = getIntegrationParamSchema.extend({
    teamId: z.string(),
});

type GetIntegrationContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getIntegrationParamSchemaWithTeamId> }, out: { param: z.infer<typeof getIntegrationParamSchemaWithTeamId> } }>;

const _getIntegrationMinimal = server.get(
    "/integrations/:integrationId",
    requireTeamAccess(),
    requireIntegrationAccess(),
    getIntegrationRouteDescription,
    zodValidator("param", getIntegrationParamSchema),
    _getIntegrationImplementation,
);

const _getIntegration = server.get(
    "/:teamId/integrations/:integrationId",
    requireTeamAccess(),
    requireIntegrationAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getIntegrationParamSchemaWithTeamId),
    _getIntegrationImplementation,
);

async function _getIntegrationImplementation(c: GetIntegrationContext) {
    try {
        const integration = await getIntegration(
            c.var.team.id,
            c.req.valid("param").integrationId
        );
        if (!integration) {
            return c.json(actionFailure("Integration not found"), 404);
        }
        return c.json(actionSuccess({ integration }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch integration"), 500);
    }
}

export type GetIntegration = typeof _getIntegration | typeof _getIntegrationMinimal;

export default server;

