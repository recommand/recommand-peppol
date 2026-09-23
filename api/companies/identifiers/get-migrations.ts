import { getCompanyIdentifier } from "@peppol/data/company-identifiers";
import { getParticipantMigrations } from "@peppol/data/participant-migrations";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { requireCompanyAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { participantMigrationResponse } from "./shared";
import type { AuthenticatedUserContext, AuthenticatedTeamContext } from "@core/lib/auth-middleware";

const server = new Server();

const getMigrationsRouteDescription = describeRoute({
    operationId: "getCompanyIdentifierMigrations",
    description: "List the migrations of an identifier between Peppol providers, newest first. Use it to see whether a stored migration key is still `pending`, has `completed`, or `failed` and why.",
    summary: "List Company Identifier Migrations",
    tags: ["Company Identifiers"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved the identifier's migrations", z.object({ migrations: z.array(participantMigrationResponse) })),
        ...describeErrorResponse(404, "Company identifier not found"),
        ...describeErrorResponse(500, "Failed to fetch company identifier migrations"),
    },
});

const getMigrationsParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company the identifier belongs to",
    }),
    identifierId: z.string().openapi({
        description: "The ID of the identifier",
    }),
});

const getMigrationsParamSchemaWithTeamId = getMigrationsParamSchema.extend({ teamId: z.string() });

type GetMigrationsContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getMigrationsParamSchemaWithTeamId> }, out: { param: z.infer<typeof getMigrationsParamSchemaWithTeamId> } }>;

const _getMigrationsMinimal = server.get(
    "/companies/:companyId/identifiers/:identifierId/migrations",
    requireCompanyAccess(),
    getMigrationsRouteDescription,
    zodValidator("param", getMigrationsParamSchema),
    _getMigrationsImplementation,
);

const _getMigrations = server.get(
    "/:teamId/companies/:companyId/identifiers/:identifierId/migrations",
    requireCompanyAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", getMigrationsParamSchemaWithTeamId),
    _getMigrationsImplementation,
);

async function _getMigrationsImplementation(c: GetMigrationsContext) {
    try {
        const { companyId, identifierId } = c.req.valid("param");
        const identifier = await getCompanyIdentifier(companyId, identifierId);
        if (!identifier) {
            return c.json(actionFailure("Company identifier not found"), 404);
        }
        const migrations = await getParticipantMigrations(companyId, identifier);
        return c.json(actionSuccess({ migrations }));
    } catch (error) {
        console.error(error);
        return c.json(actionFailure("Could not fetch company identifier migrations"), 500);
    }
}

export type GetIdentifierMigrations = typeof _getMigrations | typeof _getMigrationsMinimal;

export default server;
