import { requestInboundMigration } from "@peppol/data/participant-migrations";
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
import { UserFacingError } from "@directory/utils/util";
import { audit } from "@core/lib/audit";

const server = new Server();

const requestMigrationRouteDescription = describeRoute({
    operationId: "migrateCompanyIdentifier",
    description: "Move an identifier that another Peppol provider currently publishes for receiving over to Recommand, using the migration key that provider issued. Recipient registration is exclusive on the Peppol network; without a key the previous registration has to be removed first and the company is unreachable in between. With the key, the network switches the identifier to Recommand in one step.\n\nWhen the company is publishable right now, the migration runs immediately and the response has status `completed`. When it is not yet, for example because the company's identity check is still open, the key is stored with status `pending` and used the moment the company is registered. Submitting a new key replaces a pending one. Only companies published through Recommand's own SMP can be migrated this way.",
    summary: "Migrate Company Identifier to Recommand",
    tags: ["Company Identifiers"],
    responses: {
        ...describeSuccessResponseWithZod("The migration completed or was stored to run at registration", z.object({ migration: participantMigrationResponse })),
        ...describeErrorResponse(400, "The key was refused, is malformed, or the identifier cannot be migrated"),
        ...describeErrorResponse(404, "Company identifier not found"),
        ...describeErrorResponse(500, "Failed to migrate company identifier"),
    },
});

const requestMigrationParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company the identifier belongs to",
    }),
    identifierId: z.string().openapi({
        description: "The ID of the identifier to migrate to Recommand",
    }),
});

const requestMigrationJsonBodySchema = z.object({
    migrationKey: z.string().trim().min(8).max(24).openapi({
        description: "The migration key issued by the provider that currently publishes the identifier. 8 to 24 characters with at least two upper case letters, two lower case letters, two digits and two special characters.",
        example: "Ab12$#xyZ9!kLm",
    }),
});

const requestMigrationParamSchemaWithTeamId = requestMigrationParamSchema.extend({ teamId: z.string() });

type RequestMigrationContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof requestMigrationParamSchemaWithTeamId>, json: z.input<typeof requestMigrationJsonBodySchema> }, out: { param: z.infer<typeof requestMigrationParamSchemaWithTeamId>, json: z.infer<typeof requestMigrationJsonBodySchema> } }>;

const _requestMigrationMinimal = server.post(
    "/companies/:companyId/identifiers/:identifierId/migration",
    requireCompanyAccess(),
    requestMigrationRouteDescription,
    zodValidator("param", requestMigrationParamSchema),
    zodValidator("json", requestMigrationJsonBodySchema),
    _requestMigrationImplementation,
);

const _requestMigration = server.post(
    "/:teamId/companies/:companyId/identifiers/:identifierId/migration",
    requireCompanyAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", requestMigrationParamSchemaWithTeamId),
    zodValidator("json", requestMigrationJsonBodySchema),
    _requestMigrationImplementation,
);

async function _requestMigrationImplementation(c: RequestMigrationContext) {
    const { companyId, identifierId } = c.req.valid("param");
    try {
        const migration = await requestInboundMigration({
            companyId,
            identifierId,
            migrationKey: c.req.valid("json").migrationKey,
        });
        await audit(c, {
            action: "create",
            subsystem: "peppol.identifiers",
            objectType: "peppol.participantMigration",
            objectId: migration.id,
            after: {
                companyId,
                identifierId,
                scheme: migration.scheme,
                identifier: migration.identifier,
                direction: migration.direction,
                status: migration.status,
            },
        });

        return c.json(actionSuccess({ migration }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error.message), error.message === "Company identifier not found" ? 404 : 400);
        }
        return c.json(actionFailure("Could not migrate company identifier"), 500);
    }
}

export type RequestIdentifierMigration = typeof _requestMigration | typeof _requestMigrationMinimal;

export default server;
