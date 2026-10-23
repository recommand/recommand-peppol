import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";
import { type CompanyAccessContext, requireIntegrationAccess } from "@peppol/utils/auth-middleware";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { updateIntegrationState } from "@peppol/data/integrations";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";

const server = new Server();

const resetIntegrationStateRouteDescription = describeRoute({
    operationId: "resetIntegrationState",
    description: "Reset the state of an activated integration to an empty object",
    summary: "Reset Integration State",
    tags: ["Integrations"],
    responses: {
        ...describeSuccessResponse("Successfully reset integration state"),
        ...describeErrorResponse(500, "Failed to reset integration state"),
    },
});

const resetIntegrationStateParamSchema = z.object({
    integrationId: z.string().openapi({
        description: "The ID of the integration to reset state for",
    }),
});

const resetIntegrationStateParamSchemaWithTeamId = resetIntegrationStateParamSchema.extend({
    teamId: z.string(),
});

type ResetIntegrationStateContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof resetIntegrationStateParamSchemaWithTeamId> }, out: { param: z.infer<typeof resetIntegrationStateParamSchemaWithTeamId> } }>;

const _resetIntegrationStateMinimal = server.post(
    "/integrations/:integrationId/reset-state",
    requireTeamAccess(),
    requireIntegrationAccess(),
    resetIntegrationStateRouteDescription,
    zodValidator("param", resetIntegrationStateParamSchema),
    _resetIntegrationStateImplementation,
);

const _resetIntegrationState = server.post(
    "/:teamId/integrations/:integrationId/reset-state",
    requireTeamAccess(),
    requireIntegrationAccess(),
    describeRoute({hide: true}),
    zodValidator("param", resetIntegrationStateParamSchemaWithTeamId),
    _resetIntegrationStateImplementation,
);

async function _resetIntegrationStateImplementation(c: ResetIntegrationStateContext) {
    try {
        await updateIntegrationState(c.var.team.id, c.req.valid("param").integrationId, {});
        return c.json(actionSuccess());
    } catch (error) {
        return c.json(actionFailure("Could not reset integration state"), 500);
    }
}

export type ResetIntegrationState = typeof _resetIntegrationState | typeof _resetIntegrationStateMinimal;

export default server;

