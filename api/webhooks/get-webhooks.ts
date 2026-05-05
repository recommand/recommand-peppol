import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { webhookResponse } from "./shared";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { getWebhooks, getWebhooksByCompany } from "@peppol/data/webhooks";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";

const server = new Server();

const getWebhooksRouteDescription = describeRoute({
    operationId: "getWebhooks",
    description: "Get a list of all webhooks for a team",
    summary: "List Webhooks",
    tags: ["Webhooks"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved webhooks", z.object({ webhooks: z.array(webhookResponse) })),
        ...describeErrorResponse(500, "Failed to fetch webhooks"),
    },
});

const getWebhooksQuerySchema = z.object({
    companyId: z.string().nullish(),
});

const getWebhooksParamSchemaWithTeamId = z.object({
    teamId: z.string(),
});

type GetWebhooksContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { query: z.input<typeof getWebhooksQuerySchema>, param: z.input<typeof getWebhooksParamSchemaWithTeamId> }, out: { query: z.infer<typeof getWebhooksQuerySchema>, param: z.infer<typeof getWebhooksParamSchemaWithTeamId> } }>;

const _getWebhooksMinimal = server.get(
    "/webhooks",
    requireTeamAccess(),
    getWebhooksRouteDescription,
    zodValidator("query", getWebhooksQuerySchema),
    _getWebhooksImplementation,
);

const _getWebhooks = server.get(
    "/:teamId/webhooks",
    requireTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getWebhooksParamSchemaWithTeamId),
    zodValidator("query", getWebhooksQuerySchema),
    _getWebhooksImplementation,
);

async function _getWebhooksImplementation(c: GetWebhooksContext) {
    try {
        const { companyId } = c.req.valid("query");
        const allWebhooks = companyId
            ? await getWebhooksByCompany(c.var.team.id, companyId)
            : await getWebhooks(c.var.team.id);
        return c.json(actionSuccess({ webhooks: allWebhooks }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch webhooks"), 500);
    }
}

export type GetWebhooks = typeof _getWebhooks | typeof _getWebhooksMinimal;

export default server;