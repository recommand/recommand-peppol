import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { webhookResponse } from "./shared";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { updateWebhook } from "@peppol/data/webhooks";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { audit } from "@core/lib/audit";

const server = new Server();

const updateWebhookRouteDescription = describeRoute({
    operationId: "updateWebhook",
    description: "Update an existing webhook",
    summary: "Update Webhook",
    tags: ["Webhooks"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully updated webhook", z.object({ webhook: webhookResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(404, "Webhook not found"),
        ...describeErrorResponse(500, "Failed to update webhook"),
    },
});

const updateWebhookParamSchema = z.object({
    webhookId: z.string().openapi({
        description: "The ID of the webhook to update",
    }),
});

const updateWebhookJsonBodySchema = z.object({
    url: z.string().url(),
    companyId: z.string().nullish(),
});

const updateWebhookParamSchemaWithTeamId = updateWebhookParamSchema.extend({
    teamId: z.string(),
});

type UpdateWebhookContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof updateWebhookParamSchemaWithTeamId>, json: z.input<typeof updateWebhookJsonBodySchema> }, out: { param: z.infer<typeof updateWebhookParamSchemaWithTeamId>, json: z.infer<typeof updateWebhookJsonBodySchema> } }>;

const _updateWebhookMinimal = server.put(
    "/webhooks/:webhookId",
    requireTeamAccess(),
    updateWebhookRouteDescription,
    zodValidator("param", updateWebhookParamSchema),
    zodValidator("json", updateWebhookJsonBodySchema),
    _updateWebhookImplementation,
);

const _updateWebhook = server.put(
    "/:teamId/webhooks/:webhookId",
    requireTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", updateWebhookParamSchema.extend({ teamId: z.string() })),
    zodValidator("json", updateWebhookJsonBodySchema),
    _updateWebhookImplementation,
);

async function _updateWebhookImplementation(c: UpdateWebhookContext) {
    try {
        const webhook = await updateWebhook({
            ...c.req.valid("json"),
            teamId: c.var.team.id,
            id: c.req.valid("param").webhookId,
        });
        if (!webhook) {
            return c.json(actionFailure("Webhook not found"), 404);
        }
        await audit(c, {
            action: "update",
            subsystem: "peppol.webhooks",
            objectType: "peppol.webhook",
            objectId: webhook.id,
            after: {
                url: webhook.url,
                companyId: webhook.companyId,
            },
        });
        return c.json(actionSuccess({ webhook }));
    } catch (error) {
        return c.json(actionFailure("Could not update webhook"), 500);
    }
}

export type UpdateWebhook = typeof _updateWebhook | typeof _updateWebhookMinimal;

export default server;
