import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { assignLabelToDocument } from "@peppol/data/document-labels";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { UserFacingError } from "@peppol/utils/util";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const assignLabelRouteDescription = describeRoute({
    operationId: "assignLabelToDocument",
    description: "Assign a label to a document",
    summary: "Assign Label to Document",
    tags: ["Documents"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully assigned label to document", z.object({})),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(404, "Document or label not found"),
        ...describeErrorResponse(500, "Failed to assign label"),
    },
});

const assignLabelParamSchema = z.object({
    documentId: z.string().openapi({
        description: "The ID of the document",
    }),
    labelId: z.string().openapi({
        description: "The ID of the label to assign",
    }),
});

const assignLabelParamSchemaWithTeamId = assignLabelParamSchema.extend({
    teamId: z.string(),
});

type AssignLabelContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof assignLabelParamSchemaWithTeamId> }, out: { param: z.infer<typeof assignLabelParamSchemaWithTeamId> } }>;

const _assignLabelMinimal = server.post(
    "/documents/:documentId/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    assignLabelRouteDescription,
    zodValidator("param", assignLabelParamSchema),
    _assignLabelImplementation,
);

const _assignLabel = server.post(
    "/:teamId/documents/:documentId/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", assignLabelParamSchemaWithTeamId),
    _assignLabelImplementation,
);

async function _assignLabelImplementation(c: AssignLabelContext) {
    try {
        const { documentId, labelId } = c.req.valid("param");
        await assignLabelToDocument(c.var.team.id, documentId, labelId);
        return c.json(actionSuccess({}));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 404);
        }
        return c.json(actionFailure("Could not assign label"), 500);
    }
}

export type AssignLabel = typeof _assignLabel | typeof _assignLabelMinimal;

export default server;

