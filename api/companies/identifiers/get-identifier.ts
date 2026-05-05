import {
    getCompanyIdentifier,
} from "@peppol/data/company-identifiers";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { requireCompanyAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { companyIdentifierResponse } from "./shared";
import type { AuthenticatedUserContext, AuthenticatedTeamContext } from "@core/lib/auth-middleware";

const server = new Server();

const getIdentifierRouteDescription = describeRoute({
    operationId: "getCompanyIdentifier",
    description: "Get a specific company identifier by ID",
    summary: "Get Company Identifier",
    tags: ["Company Identifiers"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved company identifier", z.object({ identifier: companyIdentifierResponse })),
        ...describeErrorResponse(404, "Company identifier not found"),
        ...describeErrorResponse(500, "Failed to fetch company identifier"),
    },
});

const getIdentifierParamSchema = z.object({
    identifierId: z.string().openapi({
        description: "The ID of the identifier to retrieve",
    }),
});

const getIdentifierParamSchemaWithTeamId = getIdentifierParamSchema.extend({ teamId: z.string() });

type GetIdentifierContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getIdentifierParamSchemaWithTeamId> }, out: { param: z.infer<typeof getIdentifierParamSchemaWithTeamId> } }>;

const _getIdentifierMinimal = server.get(
    "/companies/:companyId/identifiers/:identifierId",
    requireCompanyAccess(),
    getIdentifierRouteDescription,
    zodValidator("param", getIdentifierParamSchema),
    _getIdentifierImplementation,
);

const _getIdentifier = server.get(
    "/:teamId/companies/:companyId/identifiers/:identifierId",
    requireCompanyAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getIdentifierParamSchemaWithTeamId),
    _getIdentifierImplementation,
);

async function _getIdentifierImplementation(c: GetIdentifierContext) {
    try {
        const identifier = await getCompanyIdentifier(c.var.company.id, c.req.valid("param").identifierId);

        if (!identifier) {
            return c.json(actionFailure("Company identifier not found"), 404);
        }

        return c.json(actionSuccess({ identifier }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch company identifier"), 500);
    }
}

export type GetIdentifier = typeof _getIdentifier | typeof _getIdentifierMinimal;

export default server;