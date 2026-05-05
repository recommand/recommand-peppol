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
import { createCompanyDocumentType } from "@peppol/data/company-document-types";
import { UserFacingError } from "@peppol/utils/util";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";

const server = new Server();

const createDocumentTypeRouteDescription = describeRoute({
    operationId: "createCompanyDocumentType",
    description: "Create a new company document type",
    summary: "Create Company Document Type",
    tags: ["Company Document Types"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully created company document type", z.object({ documentType: companyDocumentTypeResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(500, "Failed to create company document type"),
    },
});

const createDocumentTypeParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to create a document type for",
    }),
});

const createDocumentTypeJsonBodySchema = z.object({
    docTypeId: z.string().min(1, "Document type ID is required").openapi({
        description: "The ID of the document type to create",
    }),
    processId: z.string().min(1, "Process ID is required").openapi({
        description: "The ID of the process to create",
    }),
});

const createDocumentTypeParamSchemaWithTeamId = createDocumentTypeParamSchema.extend({ teamId: z.string() });

type CreateDocumentTypeContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof createDocumentTypeParamSchemaWithTeamId>, json: z.input<typeof createDocumentTypeJsonBodySchema> }, out: { param: z.infer<typeof createDocumentTypeParamSchemaWithTeamId>, json: z.infer<typeof createDocumentTypeJsonBodySchema> } }>;

const _createDocumentTypeMinimal = server.post(
    "/companies/:companyId/document-types",
    requireCompanyAccess(),
    createDocumentTypeRouteDescription,
    zodValidator("param", createDocumentTypeParamSchema),
    zodValidator("json", createDocumentTypeJsonBodySchema),
    _createDocumentTypeImplementation,
);

const _createDocumentType = server.post(
    "/:teamId/companies/:companyId/documentTypes",
    requireCompanyAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", createDocumentTypeParamSchemaWithTeamId),
    zodValidator("json", createDocumentTypeJsonBodySchema),
    _createDocumentTypeImplementation,
);

async function _createDocumentTypeImplementation(c: CreateDocumentTypeContext) {
    try {
        const skipSmpRegistration = !shouldRegisterWithSmp({ isPlayground: c.var.team.isPlayground, useTestNetwork: c.var.team.useTestNetwork, isSmpRecipient: c.var.company.isSmpRecipient, isVerified: c.var.company.isVerified, verificationRequirements: c.var.team.verificationRequirements ?? undefined });
        const documentType = await createCompanyDocumentType({
            companyDocumentType: {
                ...c.req.valid("json"),
                companyId: c.req.valid("param").companyId,
            },
            skipSmpRegistration,
            useTestNetwork: c.var.team.useTestNetwork ?? false,
        });

        return c.json(actionSuccess({ documentType }));
    } catch (error) {
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error.message), 400);
        }
        return c.json(actionFailure("Could not create company document type"), 500);
    }
}

export type CreateDocumentType = typeof _createDocumentType | typeof _createDocumentTypeMinimal;

export default server;