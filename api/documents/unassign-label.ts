import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { unassignLabelFromDocument } from "@peppol/data/document-labels";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { UserFacingError } from "@directory/utils/util";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const unassignLabelRouteDescription = describeRoute({
    operationId: "unassignLabelFromDocument",
    description: "Unassign a label from a document",
    summary: "Unassign Label from Document",
    tags: ["Documents"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully unassigned label from document", z.object({})),
        ...describeErrorResponse(404, "Document or label not found"),
        ...describeErrorResponse(500, "Failed to unassign label"),
    },
});

const unassignLabelParamSchema = z.object({
    documentId: z.string().openapi({
        description: "The ID of the document",
    }),
    labelId: z.string().openapi({
        description: "The ID of the label to unassign",
    }),
});

const unassignLabelParamSchemaWithTeamId = unassignLabelParamSchema.extend({
    teamId: z.string(),
});

type UnassignLabelContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof unassignLabelParamSchemaWithTeamId> }, out: { param: z.infer<typeof unassignLabelParamSchemaWithTeamId> } }>;

const _unassignLabelMinimal = server.delete(
    "/documents/:documentId/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    unassignLabelRouteDescription,
    zodValidator("param", unassignLabelParamSchema),
    _unassignLabelImplementation,
);

const _unassignLabel = server.delete(
    "/:teamId/documents/:documentId/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", unassignLabelParamSchemaWithTeamId),
    _unassignLabelImplementation,
);

async function _unassignLabelImplementation(c: UnassignLabelContext) {
    try {
        const { documentId, labelId } = c.req.valid("param");
        await unassignLabelFromDocument(c.var.team.id, documentId, labelId);
        return c.json(actionSuccess({}));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 404);
        }
        return c.json(actionFailure("Could not unassign label"), 500);
    }
}

export type UnassignLabel = typeof _unassignLabel | typeof _unassignLabelMinimal;

export default server;

