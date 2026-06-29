import {
    updateCompanyIdentifier,
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
import { UserFacingError } from "@peppol/utils/util";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";
import { audit } from "@core/lib/audit";

const server = new Server();

const updateIdentifierRouteDescription = describeRoute({
    operationId: "updateCompanyIdentifier",
    description: "Update an existing company identifier",
    summary: "Update Company Identifier",
    tags: ["Company Identifiers"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully updated company identifier", z.object({ identifier: companyIdentifierResponse })),
        ...describeErrorResponse(404, "Company identifier not found"),
        ...describeErrorResponse(500, "Failed to update company identifier"),
    },
});

const updateIdentifierParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to update an identifier for",
    }),
    identifierId: z.string().openapi({
        description: "The ID of the identifier to update",
    }),
});

const updateIdentifierParamSchemaWithTeamId = updateIdentifierParamSchema.extend({ teamId: z.string() });

const updateIdentifierJsonBodySchema = z.object({
    scheme: z.string().min(1, "Scheme is required").openapi({
        description: "The scheme of the identifier",
    }),
    identifier: z.string().min(1, "Identifier is required").openapi({
        description: "The value of the identifier",
    }),
});

type UpdateIdentifierContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof updateIdentifierParamSchemaWithTeamId>, json: z.input<typeof updateIdentifierJsonBodySchema> }, out: { param: z.infer<typeof updateIdentifierParamSchemaWithTeamId>, json: z.infer<typeof updateIdentifierJsonBodySchema> } }>;

const _updateIdentifierMinimal = server.put(
    "/companies/:companyId/identifiers/:identifierId",
    requireCompanyAccess(),
    updateIdentifierRouteDescription,
    zodValidator("param", updateIdentifierParamSchema),
    zodValidator("json", updateIdentifierJsonBodySchema),
    _updateIdentifierImplementation,
);

const _updateIdentifier = server.put(
    "/:teamId/companies/:companyId/identifiers/:identifierId",
    requireCompanyAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", updateIdentifierParamSchemaWithTeamId),
    zodValidator("json", updateIdentifierJsonBodySchema),
    _updateIdentifierImplementation,
);

async function _updateIdentifierImplementation(c: UpdateIdentifierContext) {
    try {
        const skipSmpRegistration = !shouldRegisterWithSmp({ isPlayground: c.var.team.isPlayground, useTestNetwork: c.var.team.useTestNetwork, isSmpRecipient: c.var.company.isSmpRecipient, isVerified: c.var.company.isVerified, verificationRequirements: c.var.team.verificationRequirements ?? undefined });
        const identifier = await updateCompanyIdentifier({
            companyIdentifier: {
                ...c.req.valid("json"),
                companyId: c.req.valid("param").companyId,
                id: c.req.valid("param").identifierId,
            },
            skipSmpRegistration,
            useTestNetwork: c.var.team.useTestNetwork ?? false,
        });
        await audit(c, {
            action: "update",
            subsystem: "peppol.identifiers",
            objectType: "peppol.identifier",
            objectId: identifier.id,
            after: {
                companyId: identifier.companyId,
                scheme: identifier.scheme,
                identifier: identifier.identifier,
            },
            metadata: { changedFields: ["scheme", "identifier"], skipSmpRegistration },
        });

        return c.json(actionSuccess({ identifier }));
    } catch (error) {
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error.message), 404);
        }
        return c.json(actionFailure("Could not update company identifier"), 500);
    }
}

export type UpdateIdentifier = typeof _updateIdentifier | typeof _updateIdentifierMinimal;

export default server;
