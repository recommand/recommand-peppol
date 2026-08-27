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
import { getCompanyDocumentTypes } from "@peppol/data/company-document-types";
import { receivingCapabilities } from "@peppol/utils/type-repository/receiving-capabilities";

const server = new Server();

const receivingCapabilityResponse = z.object({
    formatKey: z.string(),
    translatableTitle: z.string(),
    docTypeId: z.string(),
    processId: z.string(),
});

const getDocumentTypesRouteDescription = describeRoute({
    operationId: "getCompanyDocumentTypes",
    description: "Get a list of all document types for a specific company",
    summary: "List Company Document Types",
    tags: ["Company Document Types"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved company document types", z.object({
            documentTypes: z.array(companyDocumentTypeResponse),
            receivingCapabilities: z.array(receivingCapabilityResponse),
        })),
        ...describeErrorResponse(500, "Failed to fetch company document types"),
    },
});

const getDocumentTypesParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to get document types for",
    }),
});

const getDocumentTypesParamSchemaWithTeamId = getDocumentTypesParamSchema.extend({ teamId: z.string() });

type GetDocumentTypesContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getDocumentTypesParamSchemaWithTeamId> }, out: { param: z.infer<typeof getDocumentTypesParamSchemaWithTeamId> } }>;

const _getDocumentTypesMinimal = server.get(
    "/companies/:companyId/document-types",
    requireCompanyAccess(),
    getDocumentTypesRouteDescription,
    zodValidator("param", getDocumentTypesParamSchema),
    _getDocumentTypesImplementation,
);

const _getDocumentTypes = server.get(
    "/:teamId/companies/:companyId/documentTypes",
    requireCompanyAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getDocumentTypesParamSchemaWithTeamId),
    _getDocumentTypesImplementation,
);

async function _getDocumentTypesImplementation(c: GetDocumentTypesContext) {
    try {
        const documentTypes = await getCompanyDocumentTypes(c.var.company.id);
        return c.json(actionSuccess({ documentTypes, receivingCapabilities }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch company document types"), 500);
    }
}

export type GetDocumentTypes = typeof _getDocumentTypes | typeof _getDocumentTypesMinimal;

export default server;
