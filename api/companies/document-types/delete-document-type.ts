import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { requireCompanyAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import type { AuthenticatedUserContext, AuthenticatedTeamContext } from "@core/lib/auth-middleware";
import { deleteCompanyDocumentType } from "@peppol/data/company-document-types";
import { UserFacingError } from "@directory/utils/util";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";

const server = new Server();

const deleteDocumentTypeRouteDescription = describeRoute({
    operationId: "deleteCompanyDocumentType",
    description: "Delete a company document type",
    summary: "Delete Company Document Type",
    tags: ["Company Document Types"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully deleted company document type", z.object({})),
        ...describeErrorResponse(404, "Company document type not found"),
        ...describeErrorResponse(500, "Failed to delete company document type"),
    },
});

const deleteDocumentTypeParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to delete a document type for",
    }),
    documentTypeId: z.string().openapi({
        description: "The ID of the document type to delete",
    }),
});

const deleteDocumentTypeParamSchemaWithTeamId = deleteDocumentTypeParamSchema.extend({ teamId: z.string() });

type DeleteDocumentTypeContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof deleteDocumentTypeParamSchemaWithTeamId> }, out: { param: z.infer<typeof deleteDocumentTypeParamSchemaWithTeamId> } }>;

const _deleteDocumentTypeMinimal = server.delete(
    "/companies/:companyId/document-types/:documentTypeId",
    requireCompanyAccess(),
    deleteDocumentTypeRouteDescription,
    zodValidator("param", deleteDocumentTypeParamSchema),
    _deleteDocumentTypeImplementation,
);

const _deleteDocumentType = server.delete(
    "/:teamId/companies/:companyId/documentTypes/:documentTypeId",
    requireCompanyAccess(),
    describeRoute({hide: true}),
    zodValidator("param", deleteDocumentTypeParamSchemaWithTeamId),
    _deleteDocumentTypeImplementation,
);

async function _deleteDocumentTypeImplementation(c: DeleteDocumentTypeContext) {
    try {
        const skipSmpRegistration = !shouldRegisterWithSmp({ isPlayground: c.var.team.isPlayground, useTestNetwork: c.var.team.useTestNetwork, isSmpRecipient: c.var.company.isSmpRecipient, isVerified: c.var.company.isVerified, verificationRequirements: c.var.team.verificationRequirements ?? undefined });
        await deleteCompanyDocumentType({
            companyId: c.req.valid("param").companyId,
            documentTypeId: c.req.valid("param").documentTypeId,
            skipSmpRegistration,
            useTestNetwork: c.var.team.useTestNetwork ?? false,
        });

        return c.json(actionSuccess());
    } catch (error) {
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error.message), 404);
        }
        console.error(error);
        return c.json(actionFailure("Could not delete company document type"), 500);
    }
}

export type DeleteDocumentType = typeof _deleteDocumentType | typeof _deleteDocumentTypeMinimal;

export default server;