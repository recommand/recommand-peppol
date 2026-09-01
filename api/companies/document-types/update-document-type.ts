import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { requireCompanyAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { companyDocumentTypeResponse } from "./shared";
import type { AuthenticatedUserContext, AuthenticatedTeamContext } from "@core/lib/auth-middleware";
import { updateCompanyDocumentType } from "@peppol/data/company-document-types";
import { UserFacingError } from "@directory/utils/util";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";

const server = new Server();

const updateDocumentTypeRouteDescription = describeRoute({
    operationId: "updateCompanyDocumentType",
    description: "Update an existing company document type",
    summary: "Update Company Document Type",
    tags: ["Company Document Types"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully updated company document type", z.object({ documentType: companyDocumentTypeResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(404, "Company document type not found"),
        ...describeErrorResponse(500, "Failed to update company document type"),
    },
});

const updateDocumentTypeParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to update a document type for",
    }),
    documentTypeId: z.string().openapi({
        description: "The ID of the document type to update",
    }),
});

const updateDocumentTypeJsonBodySchema = z.object({
    docTypeId: z.string().min(1, "Document type ID is required").openapi({
        description: "The ID of the document type to update",
    }),
    processId: z.string().min(1, "Process ID is required").openapi({
        description: "The ID of the process to update",
    }),
});

const updateDocumentTypeParamSchemaWithTeamId = updateDocumentTypeParamSchema.extend({ teamId: z.string() });

type UpdateDocumentTypeContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof updateDocumentTypeParamSchemaWithTeamId>, json: z.input<typeof updateDocumentTypeJsonBodySchema> }, out: { param: z.infer<typeof updateDocumentTypeParamSchemaWithTeamId>, json: z.infer<typeof updateDocumentTypeJsonBodySchema> } }>;

const _updateDocumentTypeMinimal = server.put(
    "/companies/:companyId/document-types/:documentTypeId",
    requireCompanyAccess(),
    updateDocumentTypeRouteDescription,
    zodValidator("param", updateDocumentTypeParamSchema),
    zodValidator("json", updateDocumentTypeJsonBodySchema),
    _updateDocumentTypeImplementation,
);

const _updateDocumentType = server.put(
    "/:teamId/companies/:companyId/documentTypes/:documentTypeId",
    requireCompanyAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", updateDocumentTypeParamSchemaWithTeamId),
    zodValidator("json", updateDocumentTypeJsonBodySchema),
    _updateDocumentTypeImplementation,
);

async function _updateDocumentTypeImplementation(c: UpdateDocumentTypeContext) {
    try {
        const skipSmpRegistration = !shouldRegisterWithSmp({ isPlayground: c.var.team.isPlayground, useTestNetwork: c.var.team.useTestNetwork, isSmpRecipient: c.var.company.isSmpRecipient, isVerified: c.var.company.isVerified, verificationRequirements: c.var.team.verificationRequirements ?? undefined });
        const documentType = await updateCompanyDocumentType({
            companyDocumentType: {
                ...c.req.valid("json"),
                companyId: c.req.valid("param").companyId,
                id: c.req.valid("param").documentTypeId,
            },
            skipSmpRegistration,
            useTestNetwork: c.var.team.useTestNetwork ?? false,
        });

        return c.json(actionSuccess({ documentType }));
    } catch (error) {
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error.message), 404);
        }
        return c.json(actionFailure("Could not update company document type"), 500);
    }
}

export type UpdateDocumentType = typeof _updateDocumentType | typeof _updateDocumentTypeMinimal;

export default server;