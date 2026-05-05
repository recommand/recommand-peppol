import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
    deleteLabel,
} from "@peppol/data/labels";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";
import { UserFacingError } from "@peppol/utils/util";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const deleteLabelRouteDescription = describeRoute({
    operationId: "deleteLabel",
    description: "Delete a label",
    summary: "Delete Label",
    tags: ["Labels"],
    responses: {
        ...describeSuccessResponse("Successfully deleted label"),
        ...describeErrorResponse(404, "Label not found"),
        ...describeErrorResponse(500, "Failed to delete label"),
    },
});

const deleteLabelParamSchema = z.object({
    labelId: z.string().openapi({
        description: "The ID of the label to delete",
    }),
});

const deleteLabelParamSchemaWithTeamId = deleteLabelParamSchema.extend({
    teamId: z.string(),
});

type DeleteLabelContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof deleteLabelParamSchemaWithTeamId> }, out: { param: z.infer<typeof deleteLabelParamSchemaWithTeamId> } }>;

const _deleteLabelMinimal = server.delete(
    "/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    deleteLabelRouteDescription,
    zodValidator("param", deleteLabelParamSchema),
    _deleteLabelImplementation,
);

const _deleteLabel = server.delete(
    "/:teamId/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", deleteLabelParamSchemaWithTeamId),
    _deleteLabelImplementation,
);

async function _deleteLabelImplementation(c: DeleteLabelContext) {
    try {
        await deleteLabel(c.var.team.id, c.req.valid("param").labelId);
        return c.json(actionSuccess());
      } catch (error) {
        if (error instanceof UserFacingError) {
          return c.json(actionFailure(error), 404);
        }
        console.error(error);
        return c.json(actionFailure("Could not delete label"), 500);
      }
}

export type DeleteLabel = typeof _deleteLabel | typeof _deleteLabelMinimal;

export default server;

