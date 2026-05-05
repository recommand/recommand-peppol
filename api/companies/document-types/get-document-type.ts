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
import { getCompanyDocumentType } from "@peppol/data/company-document-types";

const server = new Server();

const getDocumentTypeRouteDescription = describeRoute({
    operationId: "getCompanyDocumentType",
    description: "Get a specific company document type by ID",
    summary: "Get Company Document Type",
    tags: ["Company Document Types"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved company document type", z.object({ documentType: companyDocumentTypeResponse })),
        ...describeErrorResponse(404, "Company document type not found"),
        ...describeErrorResponse(500, "Failed to fetch company document type"),
    },
});

const getDocumentTypeParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to get a document type for",
    }),
    documentTypeId: z.string().openapi({
        description: "The ID of the document type to retrieve",
    }),
});

const getDocumentTypeParamSchemaWithTeamId = getDocumentTypeParamSchema.extend({ teamId: z.string() });

type GetDocumentTypeContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getDocumentTypeParamSchemaWithTeamId> }, out: { param: z.infer<typeof getDocumentTypeParamSchemaWithTeamId> } }>;

const _getDocumentTypeMinimal = server.get(
    "/companies/:companyId/document-types/:documentTypeId",
    requireCompanyAccess(),
    getDocumentTypeRouteDescription,
    zodValidator("param", getDocumentTypeParamSchema),
    _getDocumentTypeImplementation,
);

const _getDocumentType = server.get(
    "/:teamId/companies/:companyId/documentTypes/:documentTypeId",
    requireCompanyAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getDocumentTypeParamSchemaWithTeamId),
    _getDocumentTypeImplementation,
);

async function _getDocumentTypeImplementation(c: GetDocumentTypeContext) {
    try {
        const documentType = await getCompanyDocumentType(c.var.company.id, c.req.valid("param").documentTypeId);

        if (!documentType) {
            return c.json(actionFailure("Company document type not found"), 404);
        }

        return c.json(actionSuccess({ documentType }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch company document type"), 500);
    }
}

export type GetDocumentType = typeof _getDocumentType | typeof _getDocumentTypeMinimal;

export default server;