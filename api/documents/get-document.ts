import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
    getTransmittedDocument,
    toApiTransmittedDocument,
} from "@peppol/data/transmitted-documents";
import { resolveDocumentXml } from "@peppol/data/offload/storage";
import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { transmittedDocumentResponse } from "./shared";

const server = new Server();

const getTransmittedDocumentRouteDescription = describeRoute({
    operationId: "getDocument",
    description: "Get a single transmitted document by ID",
    summary: "Get Document",
    tags: ["Documents"],
    responses: {
      ...describeSuccessResponseWithZod("Successfully retrieved the document", z.object({ document: transmittedDocumentResponse })),
      ...describeErrorResponse(404, "Document not found"),
      ...describeErrorResponse(500, "Failed to fetch document"),
    },
});

const getTransmittedDocumentParamSchema = z.object({
    documentId: z.string().openapi({
        description: "The ID of the document to retrieve",
    }),
});

const getTransmittedDocumentParamSchemaWithTeamId = getTransmittedDocumentParamSchema.extend({
    teamId: z.string(),
});

type GetTransmittedDocumentContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, {in: { param: z.input<typeof getTransmittedDocumentParamSchemaWithTeamId> }, out: { param: z.infer<typeof getTransmittedDocumentParamSchemaWithTeamId> } }>;

const _getTransmittedDocumentMinimal = server.get(
    "/documents/:documentId",
    requireIntegrationSupportedTeamAccess(),
    getTransmittedDocumentRouteDescription,
    zodValidator("param", getTransmittedDocumentParamSchema),
    _getTransmittedDocumentImplementation,
);

const _getTransmittedDocument = server.get(
    "/:teamId/documents/:documentId",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getTransmittedDocumentParamSchemaWithTeamId),
    _getTransmittedDocumentImplementation,
);

async function _getTransmittedDocumentImplementation(c: GetTransmittedDocumentContext) {
    try {
        const { documentId } = c.req.valid("param");
        const document = await getTransmittedDocument(c.var.team.id, documentId);
  
        if (!document) {
          return c.json(actionFailure("Document not found"), 404);
        }

        // Currently not mentioned in the API docs yet, so we can still roll this back if needed
        if (c.req.header("accept")?.toLowerCase().startsWith("application/xml")) {
          const xml = await resolveDocumentXml(document);
          if (xml) {
            c.header("Content-Type", "application/xml; charset=utf-8");
            return c.body(xml);
          }
        }

        return c.json(actionSuccess({ document: await toApiTransmittedDocument(document) }));
      } catch (error) {
        return c.json(actionFailure("Failed to fetch document"), 500);
      }
}

export type GetTransmittedDocument = typeof _getTransmittedDocument | typeof _getTransmittedDocumentMinimal;

export default server;
