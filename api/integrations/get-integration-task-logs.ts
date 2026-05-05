import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { type CompanyAccessContext, requireIntegrationAccess } from "@peppol/utils/auth-middleware";
import { integrationTaskLogResponse } from "./shared";
import { type AuthenticatedUserContext, type AuthenticatedTeamContext, requireTeamAccess } from "@core/lib/auth-middleware";
import { getIntegrationTaskLogs } from "@peppol/data/integrations";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";

const server = new Server();

const getIntegrationTaskLogsRouteDescription = describeRoute({
    operationId: "getIntegrationTaskLogs",
    description: "Get a paginated list of task logs for a specific integration",
    summary: "Get Integration Task Logs",
    tags: ["Integrations"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved integration task logs", z.object({
            logs: z.array(integrationTaskLogResponse),
            pagination: z.object({
                total: z.number(),
                page: z.number(),
                limit: z.number(),
                totalPages: z.number(),
            }),
        })),
        ...describeErrorResponse(404, "Integration not found"),
        ...describeErrorResponse(500, "Failed to fetch integration task logs"),
    },
});

const getIntegrationTaskLogsQuerySchema = z.object({
    page: z.coerce.number().min(1).default(1).openapi({
        description: "The page number to retrieve",
        example: 1,
    }),
    limit: z.coerce.number().min(1).max(100).default(10).openapi({
        description: "The number of items per page",
        example: 10,
    }),
});

const getIntegrationTaskLogsParamSchema = z.object({
    integrationId: z.string().openapi({
        description: "The ID of the integration",
    }),
});

const getIntegrationTaskLogsParamSchemaWithTeamId = getIntegrationTaskLogsParamSchema.extend({
    teamId: z.string(),
});

type GetIntegrationTaskLogsContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getIntegrationTaskLogsParamSchemaWithTeamId>, query: z.input<typeof getIntegrationTaskLogsQuerySchema> }, out: { param: z.infer<typeof getIntegrationTaskLogsParamSchemaWithTeamId>, query: z.infer<typeof getIntegrationTaskLogsQuerySchema> } }>;

const _getIntegrationTaskLogsMinimal = server.get(
    "/integrations/:integrationId/task-logs",
    requireTeamAccess(),
    requireIntegrationAccess(),
    getIntegrationTaskLogsRouteDescription,
    zodValidator("param", getIntegrationTaskLogsParamSchema),
    zodValidator("query", getIntegrationTaskLogsQuerySchema),
    _getIntegrationTaskLogsImplementation,
);

const _getIntegrationTaskLogs = server.get(
    "/:teamId/integrations/:integrationId/task-logs",
    requireTeamAccess(),
    requireIntegrationAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getIntegrationTaskLogsParamSchemaWithTeamId),
    zodValidator("query", getIntegrationTaskLogsQuerySchema),
    _getIntegrationTaskLogsImplementation,
);

async function _getIntegrationTaskLogsImplementation(c: GetIntegrationTaskLogsContext) {
    try {
        const { integrationId } = c.req.valid("param");
        const { page, limit } = c.req.valid("query");
        const { logs, total } = await getIntegrationTaskLogs(
            c.var.team.id,
            integrationId,
            { page, limit }
        );

        return c.json(
            actionSuccess({
                logs,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                },
            })
        );
    } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
            return c.json(actionFailure("Integration not found"), 404);
        }
        return c.json(actionFailure("Could not fetch integration task logs"), 500);
    }
}

export type GetIntegrationTaskLogs = typeof _getIntegrationTaskLogs | typeof _getIntegrationTaskLogsMinimal;

export default server;

