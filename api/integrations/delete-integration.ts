import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";
import { type CompanyAccessContext, requireIntegrationAccess } from "@peppol/utils/auth-middleware";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { deleteIntegration } from "@peppol/data/integrations";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { audit } from "@core/lib/audit";

const server = new Server();

const deleteIntegrationRouteDescription = describeRoute({
    operationId: "deleteIntegration",
    description: "Delete an activated integration",
    summary: "Delete Integration",
    tags: ["Integrations"],
    responses: {
        ...describeSuccessResponse("Successfully deleted integration"),
        ...describeErrorResponse(500, "Failed to delete integration"),
    },
});

const deleteIntegrationParamSchema = z.object({
    integrationId: z.string().openapi({
        description: "The ID of the integration to delete",
    }),
});

const deleteIntegrationParamSchemaWithTeamId = deleteIntegrationParamSchema.extend({
    teamId: z.string(),
});

type DeleteIntegrationContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof deleteIntegrationParamSchemaWithTeamId> }, out: { param: z.infer<typeof deleteIntegrationParamSchemaWithTeamId> } }>;

const _deleteIntegrationMinimal = server.delete(
    "/integrations/:integrationId",
    requireTeamAccess(),
    requireIntegrationAccess(),
    deleteIntegrationRouteDescription,
    zodValidator("param", deleteIntegrationParamSchema),
    _deleteIntegrationImplementation,
);

const _deleteIntegration = server.delete(
    "/:teamId/integrations/:integrationId",
    requireTeamAccess(),
    requireIntegrationAccess(),
    describeRoute({hide: true}),
    zodValidator("param", deleteIntegrationParamSchemaWithTeamId),
    _deleteIntegrationImplementation,
);

async function _deleteIntegrationImplementation(c: DeleteIntegrationContext) {
    try {
        const integrationId = c.req.valid("param").integrationId;
        await deleteIntegration(c.var.team.id, integrationId);
        await audit(c, {
            action: "delete",
            subsystem: "peppol.integrations",
            objectType: "peppol.integration",
            objectId: integrationId,
        });
        return c.json(actionSuccess());
    } catch (error) {
        return c.json(actionFailure("Could not delete integration"), 500);
    }
}

export type DeleteIntegration = typeof _deleteIntegration | typeof _deleteIntegrationMinimal;

export default server;
