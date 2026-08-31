import {
    createCompanyIdentifier,
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
import { UserFacingError } from "@directory/utils/util";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";
import { audit } from "@core/lib/audit";

const server = new Server();

const createIdentifierRouteDescription = describeRoute({
    operationId: "createCompanyIdentifier",
    description: "Create a new company identifier",
    summary: "Create Company Identifier",
    tags: ["Company Identifiers"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully created company identifier", z.object({ identifier: companyIdentifierResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(500, "Failed to create company identifier"),
    },
});

const createIdentifierParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to create an identifier for",
    }),
});

const createIdentifierJsonBodySchema = z.object({
    scheme: z.string().min(1, "Scheme is required").openapi({
        description: "The scheme of the identifier",
    }),
    identifier: z.string().min(1, "Identifier is required").openapi({
        description: "The value of the identifier",
    }),
});

const createIdentifierParamSchemaWithTeamId = createIdentifierParamSchema.extend({ teamId: z.string() });

type CreateIdentifierContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof createIdentifierParamSchemaWithTeamId>, json: z.input<typeof createIdentifierJsonBodySchema> }, out: { param: z.infer<typeof createIdentifierParamSchemaWithTeamId>, json: z.infer<typeof createIdentifierJsonBodySchema> } }>;

const _createIdentifierMinimal = server.post(
    "/companies/:companyId/identifiers",
    requireCompanyAccess(),
    createIdentifierRouteDescription,
    zodValidator("param", createIdentifierParamSchema),
    zodValidator("json", createIdentifierJsonBodySchema),
    _createIdentifierImplementation,
);

const _createIdentifier = server.post(
    "/:teamId/companies/:companyId/identifiers",
    requireCompanyAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", createIdentifierParamSchemaWithTeamId),
    zodValidator("json", createIdentifierJsonBodySchema),
    _createIdentifierImplementation,
);

async function _createIdentifierImplementation(c: CreateIdentifierContext) {
    try {
        const skipSmpRegistration = !shouldRegisterWithSmp({ isPlayground: c.var.team.isPlayground, useTestNetwork: c.var.team.useTestNetwork, isSmpRecipient: c.var.company.isSmpRecipient, isVerified: c.var.company.isVerified, verificationRequirements: c.var.team.verificationRequirements ?? undefined });
        const identifier = await createCompanyIdentifier({
            companyIdentifier: {
                ...c.req.valid("json"),
                companyId: c.req.valid("param").companyId,
            },
            skipSmpRegistration,
            useTestNetwork: c.var.team.useTestNetwork ?? false,
        });
        await audit(c, {
            action: "create",
            subsystem: "peppol.identifiers",
            objectType: "peppol.identifier",
            objectId: identifier.id,
            after: {
                companyId: identifier.companyId,
                scheme: identifier.scheme,
                identifier: identifier.identifier,
            },
            metadata: { skipSmpRegistration },
        });

        return c.json(actionSuccess({ identifier }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error.message), 400);
        }
        return c.json(actionFailure("Could not create company identifier"), 500);
    }
}

export type CreateIdentifier = typeof _createIdentifier | typeof _createIdentifierMinimal;

export default server;
