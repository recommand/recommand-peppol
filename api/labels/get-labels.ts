import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
    getLabels,
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

const getLabelsRouteDescription = describeRoute({
    operationId: "getLabels",
    description: "Get a list of all labels for a team",
    summary: "List Labels",
    tags: ["Labels"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved labels", z.object({ labels: z.array(labelResponse) })),
        ...describeErrorResponse(500, "Failed to fetch labels"),
    },
});

type GetLabelsContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string>;

const _getLabelsMinimal = server.get(
    "/labels",
    requireIntegrationSupportedTeamAccess(),
    getLabelsRouteDescription,
    _getLabelsImplementation,
);

const _getLabels = server.get(
    "/:teamId/labels",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", z.object({
        teamId: z.string(),
    })),
    _getLabelsImplementation,
);

async function _getLabelsImplementation(c: GetLabelsContext) {
    try {
        const allLabels = await getLabels(c.var.team.id);
        return c.json(actionSuccess({ labels: allLabels }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch labels"), 500);
    }
}

export type GetLabels = typeof _getLabels | typeof _getLabelsMinimal;

export default server;

