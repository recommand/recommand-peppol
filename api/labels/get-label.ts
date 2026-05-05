import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
    getLabel,
} from "@peppol/data/labels";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { labelResponse } from "./shared";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const getLabelRouteDescription = describeRoute({
    operationId: "getLabel",
    description: "Get a single label by ID",
    summary: "Get Label",
    tags: ["Labels"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved label", z.object({ label: labelResponse })),
        ...describeErrorResponse(404, "Label not found"),
        ...describeErrorResponse(500, "Failed to fetch label"),
    },
});

const getLabelParamSchema = z.object({
    labelId: z.string().openapi({
        description: "The ID of the label to retrieve",
    }),
});

type GetLabelContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof getLabelParamSchema> }, out: { param: z.infer<typeof getLabelParamSchema> } }>;

const _getLabelMinimal = server.get(
    "/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    getLabelRouteDescription,
    zodValidator("param", getLabelParamSchema),
    _getLabelImplementation,
);

const _getLabel = server.get(
    "/:teamId/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getLabelParamSchema.extend({
        teamId: z.string(),
    })),
    _getLabelImplementation,
);

async function _getLabelImplementation(c: GetLabelContext) {
    try {
        const label = await getLabel(c.var.team.id, c.req.valid("param").labelId);
        if (!label) {
            return c.json(actionFailure("Label not found"), 404);
        }
        return c.json(actionSuccess({ label }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch label"), 500);
    }
}

export type GetLabel = typeof _getLabel | typeof _getLabelMinimal;

export default server;

