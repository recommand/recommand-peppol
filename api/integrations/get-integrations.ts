import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { type CompanyAccessContext, requireIntegrationAccess } from "@peppol/utils/auth-middleware";
import { integrationResponse } from "./shared";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { getIntegrations, getIntegrationsByCompany } from "@peppol/data/integrations";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";

const server = new Server();

const getIntegrationsRouteDescription = describeRoute({
    operationId: "getIntegrations",
    description: "Get a list of all activated integrations for a team",
    summary: "List Integrations",
    tags: ["Integrations"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved integrations", z.object({ integrations: z.array(integrationResponse) })),
        ...describeErrorResponse(500, "Failed to fetch integrations"),
    },
});

const getIntegrationsQuerySchema = z.object({
    companyId: z.string().nullish(),
});

const getIntegrationsParamSchemaWithTeamId = z.object({
    teamId: z.string(),
});

type GetIntegrationsContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { query: z.input<typeof getIntegrationsQuerySchema>, param: z.input<typeof getIntegrationsParamSchemaWithTeamId> }, out: { query: z.infer<typeof getIntegrationsQuerySchema>, param: z.infer<typeof getIntegrationsParamSchemaWithTeamId> } }>;

const _getIntegrationsMinimal = server.get(
    "/integrations",
    requireTeamAccess(),
    requireIntegrationAccess(),
    getIntegrationsRouteDescription,
    zodValidator("query", getIntegrationsQuerySchema),
    _getIntegrationsImplementation,
);

const _getIntegrations = server.get(
    "/:teamId/integrations",
    requireTeamAccess(),
    requireIntegrationAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getIntegrationsParamSchemaWithTeamId),
    zodValidator("query", getIntegrationsQuerySchema),
    _getIntegrationsImplementation,
);

async function _getIntegrationsImplementation(c: GetIntegrationsContext) {
    try {
        const { companyId } = c.req.valid("query");
        const allIntegrations = companyId
            ? await getIntegrationsByCompany(c.var.team.id, companyId)
            : await getIntegrations(c.var.team.id);
        return c.json(actionSuccess({ integrations: allIntegrations }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch integrations"), 500);
    }
}

export type GetIntegrations = typeof _getIntegrations | typeof _getIntegrationsMinimal;

export default server;

