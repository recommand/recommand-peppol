import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { webhookResponse } from "./shared";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { getWebhook } from "@peppol/data/webhooks";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";

const server = new Server();

const getWebhookRouteDescription = describeRoute({
    operationId: "getWebhook",
    description: "Get a specific webhook by ID",
    summary: "Get Webhook",
    tags: ["Webhooks"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved webhook", z.object({ webhook: webhookResponse })),
        ...describeErrorResponse(404, "Webhook not found"),
        ...describeErrorResponse(500, "Failed to fetch webhook"),
    },
});

const getWebhookParamSchema = z.object({
    webhookId: z.string().openapi({
        description: "The ID of the webhook to retrieve",
    }),
});

const getWebhookParamSchemaWithTeamId = getWebhookParamSchema.extend({
    teamId: z.string(),
});

type GetWebhookContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getWebhookParamSchemaWithTeamId> }, out: { param: z.infer<typeof getWebhookParamSchemaWithTeamId> } }>;

const _getWebhookMinimal = server.get(
    "/webhooks/:webhookId",
    requireTeamAccess(),
    getWebhookRouteDescription,
    zodValidator("param", getWebhookParamSchema),
    _getWebhookImplementation,
);

const _getWebhook = server.get(
    "/:teamId/webhooks/:webhookId",
    requireTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getWebhookParamSchemaWithTeamId),
    _getWebhookImplementation,
);

async function _getWebhookImplementation(c: GetWebhookContext) {
    try {
        const webhook = await getWebhook(
            c.var.team.id,
            c.req.valid("param").webhookId
        );
        if (!webhook) {
            return c.json(actionFailure("Webhook not found"), 404);
        }
        return c.json(actionSuccess({ webhook }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch webhook"), 500);
    }
}

export type GetWebhook = typeof _getWebhook | typeof _getWebhookMinimal;

export default server;