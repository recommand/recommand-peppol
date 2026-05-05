import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { type CompanyAccessContext, requireIntegrationAccess } from "@peppol/utils/auth-middleware";
import { integrationResponse } from "./shared";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { updateIntegration } from "@peppol/data/integrations";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { manifestSchema } from "@peppol/types/integration/manifest";
import { configurationSchema } from "@peppol/types/integration/configuration";
import { UserFacingError } from "@peppol/utils/util";

const server = new Server();

const updateIntegrationRouteDescription = describeRoute({
    operationId: "updateIntegration",
    description: "Update an existing activated integration",
    summary: "Update Integration",
    tags: ["Integrations"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully updated integration", z.object({ integration: integrationResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(404, "Integration not found"),
        ...describeErrorResponse(500, "Failed to update integration"),
    },
});

const updateIntegrationParamSchema = z.object({
    integrationId: z.string().openapi({
        description: "The ID of the integration to update",
    }),
});

const updateIntegrationJsonBodySchema = z.object({
    companyId: z.string(),
    configuration: configurationSchema,
}).strict();

const updateIntegrationParamSchemaWithTeamId = updateIntegrationParamSchema.extend({
    teamId: z.string(),
});

type UpdateIntegrationContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof updateIntegrationParamSchemaWithTeamId>, json: z.input<typeof updateIntegrationJsonBodySchema> }, out: { param: z.infer<typeof updateIntegrationParamSchemaWithTeamId>, json: z.infer<typeof updateIntegrationJsonBodySchema> } }>;

const _updateIntegrationMinimal = server.put(
    "/integrations/:integrationId",
    requireTeamAccess(),
    requireIntegrationAccess(),
    updateIntegrationRouteDescription,
    zodValidator("param", updateIntegrationParamSchema),
    zodValidator("json", updateIntegrationJsonBodySchema),
    _updateIntegrationImplementation,
);

const _updateIntegration = server.put(
    "/:teamId/integrations/:integrationId",
    requireTeamAccess(),
    requireIntegrationAccess(),
    describeRoute({hide: true}),
    zodValidator("param", updateIntegrationParamSchema.extend({ teamId: z.string() })),
    zodValidator("json", updateIntegrationJsonBodySchema),
    _updateIntegrationImplementation,
);

async function _updateIntegrationImplementation(c: UpdateIntegrationContext) {
    try {
        const integration = await updateIntegration({
            ...c.req.valid("json"),
            teamId: c.var.team.id,
            id: c.req.valid("param").integrationId,
        });
        if (!integration) {
            return c.json(actionFailure("Integration not found"), 404);
        }
        return c.json(actionSuccess({ integration }));
    } catch (error) {
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not update integration"), 500);
    }
}

export type UpdateIntegration = typeof _updateIntegration | typeof _updateIntegrationMinimal;

export default server;

