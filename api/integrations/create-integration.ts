import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { type CompanyAccessContext, requireIntegrationAccess } from "@peppol/utils/auth-middleware";
import { integrationResponse } from "./shared";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { createIntegration } from "@peppol/data/integrations";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { manifestSchema } from "@peppol/types/integration/manifest";
import { configurationSchema } from "@peppol/types/integration/configuration";
import { UserFacingError } from "@peppol/utils/util";
import { audit } from "@core/lib/audit";

const server = new Server();

const createIntegrationRouteDescription = describeRoute({
    operationId: "createIntegration",
    description: "Create a new activated integration",
    summary: "Create Integration",
    tags: ["Integrations"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully created integration", z.object({ integration: integrationResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(500, "Failed to create integration"),
    },
});

const createIntegrationJsonBodySchema = z.object({
    companyId: z.string(),
    manifest: manifestSchema.optional(),
    url: z.string().url().optional(),
    configuration: configurationSchema.nullish(),
}).strict().refine(
    (data) => data.manifest !== undefined || data.url !== undefined,
    {
        message: "Either 'manifest' or 'url' must be provided",
        path: ["manifest"],
    }
);

const createIntegrationParamSchemaWithTeamId = z.object({
    teamId: z.string(),
});

type CreateIntegrationContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { json: z.input<typeof createIntegrationJsonBodySchema>, param: z.input<typeof createIntegrationParamSchemaWithTeamId> }, out: { json: z.infer<typeof createIntegrationJsonBodySchema>, param: z.infer<typeof createIntegrationParamSchemaWithTeamId> } }>;

const _createIntegrationMinimal = server.post(
    "/integrations",
    requireTeamAccess(),
    requireIntegrationAccess(),
    createIntegrationRouteDescription,
    zodValidator("json", createIntegrationJsonBodySchema),
    _createIntegrationImplementation,
);

const _createIntegration = server.post(
    "/:teamId/integrations",
    requireTeamAccess(),
    requireIntegrationAccess(),
    describeRoute({hide: true}),
    zodValidator("param", createIntegrationParamSchemaWithTeamId),
    zodValidator("json", createIntegrationJsonBodySchema),
    _createIntegrationImplementation,
);

async function _createIntegrationImplementation(c: CreateIntegrationContext) {
    try {
        const integration = await createIntegration({
            ...c.req.valid("json"),
            teamId: c.var.team.id,
        });
        await audit(c, {
            action: "create",
            subsystem: "peppol.integrations",
            objectType: "peppol.integration",
            objectId: integration.id,
            after: {
                companyId: integration.companyId,
                manifestName: integration.manifest.name,
                manifestVersion: integration.manifest.version,
                configuration: "set",
            },
        });
        return c.json(actionSuccess({ integration }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not create integration"), 500);
    }
}

export type CreateIntegration = typeof _createIntegration | typeof _createIntegrationMinimal;

export default server;
