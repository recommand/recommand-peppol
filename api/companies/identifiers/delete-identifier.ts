import {
    deleteCompanyIdentifier,
} from "@peppol/data/company-identifiers";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { requireCompanyAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import type { AuthenticatedUserContext, AuthenticatedTeamContext } from "@core/lib/auth-middleware";
import { UserFacingError } from "@peppol/utils/util";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";
import { audit } from "@core/lib/audit";

const server = new Server();

const deleteIdentifierRouteDescription = describeRoute({
    operationId: "deleteCompanyIdentifier",
    description: "Delete a company identifier",
    summary: "Delete Company Identifier",
    tags: ["Company Identifiers"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully deleted company identifier", z.object({})),
        ...describeErrorResponse(404, "Company identifier not found"),
        ...describeErrorResponse(500, "Failed to delete company identifier"),
    },
});

const deleteIdentifierParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to delete an identifier for",
    }),
    identifierId: z.string().openapi({
        description: "The ID of the identifier to delete",
    }),
});

const deleteIdentifierParamSchemaWithTeamId = deleteIdentifierParamSchema.extend({ teamId: z.string() });

type DeleteIdentifierContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof deleteIdentifierParamSchemaWithTeamId> }, out: { param: z.infer<typeof deleteIdentifierParamSchemaWithTeamId> } }>;

const _deleteIdentifierMinimal = server.delete(
    "/companies/:companyId/identifiers/:identifierId",
    requireCompanyAccess(),
    deleteIdentifierRouteDescription,
    zodValidator("param", deleteIdentifierParamSchema),
    _deleteIdentifierImplementation,
);

const _deleteIdentifier = server.delete(
    "/:teamId/companies/:companyId/identifiers/:identifierId",
    requireCompanyAccess(),
    describeRoute({hide: true}),
    zodValidator("param", deleteIdentifierParamSchemaWithTeamId),
    _deleteIdentifierImplementation,
);

async function _deleteIdentifierImplementation(c: DeleteIdentifierContext) {
    try {
        const skipSmpRegistration = !shouldRegisterWithSmp({ isPlayground: c.var.team.isPlayground, useTestNetwork: c.var.team.useTestNetwork, isSmpRecipient: c.var.company.isSmpRecipient, isVerified: c.var.company.isVerified, verificationRequirements: c.var.team.verificationRequirements ?? undefined, smpProvider: c.var.company.smpProvider });
        const { companyId, identifierId } = c.req.valid("param");
        await deleteCompanyIdentifier({
            companyId,
            identifierId,
            skipSmpRegistration,
            useTestNetwork: c.var.team.useTestNetwork ?? false,
        });
        await audit(c, {
            action: "delete",
            subsystem: "peppol.identifiers",
            objectType: "peppol.identifier",
            objectId: identifierId,
            metadata: { companyId, skipSmpRegistration },
        });

        return c.json(actionSuccess());
    } catch (error) {
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error.message), 404);
        }
        console.error(error);
        return c.json(actionFailure("Could not delete company identifier"), 500);
    }
}

export type DeleteIdentifier = typeof _deleteIdentifier | typeof _deleteIdentifierMinimal;

export default server;
