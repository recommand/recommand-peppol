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
import { audit } from "@core/lib/audit";

const server = new Server();

const createWebhookRouteDescription = describeRoute({
    operationId: "createWebhook",
    description: "Register an HTTPS endpoint that Recommand posts events to as they happen, so you do not have to poll the documents endpoints. It receives every peppol event for the team: `document.received`, `document.sent`, `document.delivery_status_changed`, `document.label.assigned`, `document.label.unassigned`, `document.reporting_status_changed` and `company.verification`. There is no per-event subscription. Set a `secret` to have every delivery signed, and check that signature before acting on a request. Deliveries are retried for a while on a timeout or a 5xx; any other response is treated as final.",
    summary: "Create Webhook",
    tags: ["Webhooks"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully created webhook", z.object({ webhook: webhookResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(500, "Failed to create webhook"),
    },
});

const createWebhookJsonBodySchema = z.object({
    url: z.string().url().openapi({
        description: "The HTTPS endpoint to deliver events to. Each delivery is a JSON POST carrying the event, with an `X-Idempotency-Key` header you can use to discard a redelivery. Answer with a 2xx once you have accepted the event; a timeout or a 5xx is retried, anything else is not.",
        example: "https://example.com/hooks/recommand",
    }),
    companyId: z.string().nullish().openapi({
        description: "Limit the webhook to one company's events. Leave it out to receive the events of every company in the team.",
        example: "c_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    secret: z.preprocess(
        (value) => value === "" ? undefined : value,
        z.string().min(1).nullish()
    ).openapi({
        description: "Optional secret used to send X-Signature: sha256=<hex>, computed with HMAC-SHA256 over the raw request body. Leave it out to have deliveries sent unsigned.",
    }),
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
        await audit(c, {
            action: "create",
            subsystem: "peppol.webhooks",
            objectType: "peppol.webhook",
            objectId: webhook.id,
            after: {
                url: webhook.url,
                companyId: webhook.companyId,
                signingEnabled: webhook.secret !== null,
            },
        });
        return c.json(actionSuccess({ webhook }));
    } catch (error) {
        return c.json(actionFailure("Could not create webhook"), 500);
    }
}

export type CreateWebhook = typeof _createWebhook | typeof _createWebhookMinimal;

export default server;
