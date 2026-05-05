import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { webhookResponse } from "./shared";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { createWebhook } from "@peppol/data/webhooks";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";

const server = new Server();

const createWebhookRouteDescription = describeRoute({
    operationId: "createWebhook",
    description: "Create a new webhook",
    summary: "Create Webhook",
    tags: ["Webhooks"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully created webhook", z.object({ webhook: webhookResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(500, "Failed to create webhook"),
    },
});

const createWebhookJsonBodySchema = z.object({
    url: z.string().url(),
    companyId: z.string().nullish(),
});

const createWebhookParamSchemaWithTeamId = z.object({
    teamId: z.string(),
});

type CreateWebhookContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { json: z.input<typeof createWebhookJsonBodySchema>, param: z.input<typeof createWebhookParamSchemaWithTeamId> }, out: { json: z.infer<typeof createWebhookJsonBodySchema>, param: z.infer<typeof createWebhookParamSchemaWithTeamId> } }>;

const _createWebhookMinimal = server.post(
    "/webhooks",
    requireTeamAccess(),
    createWebhookRouteDescription,
    zodValidator("json", createWebhookJsonBodySchema),
    _createWebhookImplementation,
);

const _createWebhook = server.post(
    "/:teamId/webhooks",
    requireTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", createWebhookParamSchemaWithTeamId),
    zodValidator("json", createWebhookJsonBodySchema),
    _createWebhookImplementation,
);

async function _createWebhookImplementation(c: CreateWebhookContext) {
    try {
        const webhook = await createWebhook({
            ...c.req.valid("json"),
            teamId: c.var.team.id,
        });
        return c.json(actionSuccess({ webhook }));
    } catch (error) {
        return c.json(actionFailure("Could not create webhook"), 500);
    }
}

export type CreateWebhook = typeof _createWebhook | typeof _createWebhookMinimal;

export default server;