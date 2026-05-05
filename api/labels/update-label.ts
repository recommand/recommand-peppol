import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
    updateLabel,
} from "@peppol/data/labels";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { labelResponse } from "./shared";
import { UserFacingError } from "@peppol/utils/util";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const updateLabelRouteDescription = describeRoute({
    operationId: "updateLabel",
    description: "Update an existing label",
    summary: "Update Label",
    tags: ["Labels"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully updated label", z.object({ label: labelResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(404, "Label not found"),
        ...describeErrorResponse(500, "Failed to update label"),
    },
});

const updateLabelParamSchema = z.object({
    labelId: z.string().openapi({
        description: "The ID of the label to update",
    }),
});

const updateLabelParamSchemaWithTeamId = updateLabelParamSchema.extend({
    teamId: z.string(),
});

const hexColorRegex = /^#[A-Fa-f0-9]{6}$/;

const updateLabelJsonBodySchema = z.object({
    name: z.string().min(1).optional(),
    colorHex: z.string().regex(hexColorRegex, "Color must be a valid hex color (e.g., #3B82F6)").optional(),
    externalId: z.string().optional().nullable(),
});

type UpdateLabelContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof updateLabelParamSchemaWithTeamId>, json: z.input<typeof updateLabelJsonBodySchema> }, out: { param: z.infer<typeof updateLabelParamSchemaWithTeamId>, json: z.infer<typeof updateLabelJsonBodySchema> } }>;

const _updateLabelMinimal = server.put(
    "/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    updateLabelRouteDescription,
    zodValidator("param", updateLabelParamSchema),
    zodValidator("json", updateLabelJsonBodySchema),
    _updateLabelImplementation,
);

const _updateLabel = server.put(
    "/:teamId/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", updateLabelParamSchemaWithTeamId),
    zodValidator("json", updateLabelJsonBodySchema),
    _updateLabelImplementation,
);

async function _updateLabelImplementation(c: UpdateLabelContext) {
    try {
        const updateData = c.req.valid("json");
  
        const label = await updateLabel({
          ...updateData,
          teamId: c.var.team.id,
          id: c.req.valid("param").labelId,
        });
        return c.json(actionSuccess({ label }));
      } catch (error) {
        if (error instanceof UserFacingError) {
          return c.json(actionFailure(error), 404);
        }
        console.error(error);
        return c.json(actionFailure("Could not update label"), 500);
      }
}

export type UpdateLabel = typeof _updateLabel | typeof _updateLabelMinimal;

export default server;

