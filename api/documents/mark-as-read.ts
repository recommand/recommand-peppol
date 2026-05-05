import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
    markAsRead,
} from "@peppol/data/transmitted-documents";
import {
    describeErrorResponse,
    describeSuccessResponse,
} from "@core/lib/api-docs";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";

const server = new Server();

const markAsReadRouteDescription = describeRoute({
    operationId: "markAsRead",
    description: "Mark a document as read or unread",
    summary: "Mark Document as Read",
    tags: ["Documents"],
    responses: {
        ...describeSuccessResponse("Successfully updated document read status"),
        ...describeErrorResponse(404, "Document not found"),
        ...describeErrorResponse(500, "Failed to update document read status"),
    },
});

const markAsReadParamSchema = z.object({
    documentId: z.string().openapi({
        description: "The ID of the document to mark as read or unread",
    }),
});

const markAsReadParamSchemaWithTeamId = markAsReadParamSchema.extend({
    teamId: z.string(),
});

const markAsReadJsonBodySchema = z.object({
    read: z.boolean().optional().default(true).openapi({
        description: "Whether to mark the document as read (true) or unread (false). If not provided, defaults to true.",
        example: true,
    }),
}).optional();

type MarkAsReadContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof markAsReadParamSchemaWithTeamId>, json: z.input<typeof markAsReadJsonBodySchema> }, out: { param: z.infer<typeof markAsReadParamSchemaWithTeamId>, json: z.infer<typeof markAsReadJsonBodySchema> } }>;

const _markAsReadMinimal = server.post(
    "/documents/:documentId/mark-as-read",
    requireIntegrationSupportedTeamAccess(),
    markAsReadRouteDescription,
    zodValidator("param", markAsReadParamSchema),
    zodValidator("json", markAsReadJsonBodySchema),
    _markAsReadImplementation,
);

const _markAsRead = server.post(
    "/:teamId/documents/:documentId/markAsRead",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", markAsReadParamSchemaWithTeamId),
    zodValidator("json", markAsReadJsonBodySchema),
    _markAsReadImplementation,
);

async function _markAsReadImplementation(c: MarkAsReadContext) {
    try {
        const { documentId } = c.req.valid("param");
        const { read = true } = c.req.valid("json") ?? {};
        await markAsRead(c.var.team.id, documentId, read);
        return c.json(actionSuccess());
    } catch (error) {
        if (error instanceof Error && error.message === "Document not found") {
            return c.json(actionFailure("Document not found"), 404);
        }
        return c.json(
            actionFailure("Failed to update document read status"),
            500
        );
    }
}

export type MarkAsRead = typeof _markAsRead | typeof _markAsReadMinimal;

export default server;