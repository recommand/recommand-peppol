import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
    deleteTransmittedDocument,
} from "@peppol/data/transmitted-documents";
import {
    describeErrorResponse,
    describeSuccessResponse,
} from "@core/lib/api-docs";
import type { CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { audit } from "@core/lib/audit";

const server = new Server();

const deleteTransmittedDocumentRouteDescription = describeRoute({
    operationId: "deleteDocument",
    description: "Delete a transmitted document",
    summary: "Delete Document",
    tags: ["Documents"],
    responses: {
        ...describeSuccessResponse("Successfully deleted the document"),
        ...describeErrorResponse(404, "Document not found"),
        ...describeErrorResponse(500, "Failed to delete document"),
    },
});

const deleteTransmittedDocumentParamSchema = z.object({
    documentId: z.string().openapi({
        description: "The ID of the document to delete",
    }),
});

const deleteTransmittedDocumentParamSchemaWithTeamId = deleteTransmittedDocumentParamSchema.extend({
    teamId: z.string(),
});

type DeleteTransmittedDocumentContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof deleteTransmittedDocumentParamSchemaWithTeamId> }, out: { param: z.infer<typeof deleteTransmittedDocumentParamSchemaWithTeamId> } }>;

const _deleteTransmittedDocumentMinimal = server.delete(
    "/documents/:documentId",
    requireTeamAccess(),
    deleteTransmittedDocumentRouteDescription,
    zodValidator("param", deleteTransmittedDocumentParamSchema),
    _deleteTransmittedDocumentImplementation,
);

const _deleteTransmittedDocument = server.delete(
    "/:teamId/documents/:documentId",
    requireTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", deleteTransmittedDocumentParamSchemaWithTeamId),
    _deleteTransmittedDocumentImplementation,
);

async function _deleteTransmittedDocumentImplementation(c: DeleteTransmittedDocumentContext) {
    try {
        const { documentId } = c.req.valid("param");
        await deleteTransmittedDocument(c.var.team.id, documentId);
        await audit(c, {
            action: "delete",
            subsystem: "peppol.documents",
            objectType: "peppol.document",
            objectId: documentId,
        });
        return c.json(actionSuccess());
    } catch (error) {
        if (error instanceof Error && error.message === "Document not found") {
            return c.json(actionFailure("Document not found"), 404);
        }
        return c.json(actionFailure("Failed to delete document"), 500);
    }
}

export type DeleteTransmittedDocument = typeof _deleteTransmittedDocument | typeof _deleteTransmittedDocumentMinimal;

export default server;
