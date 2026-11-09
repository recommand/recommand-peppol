import { requireDocumentAccess, requirePermission } from "@peppol/utils/auth-middleware";
import { Server, type Context } from "@recommand/lib/api";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
    deleteAllTransmittedDocuments,
} from "@peppol/data/transmitted-documents";
import { getExtendedTeam } from "@peppol/data/teams";

const server = new Server();

const deleteAllTransmittedDocumentsParamSchemaWithTeamId = z.object({
    teamId: z.string(),
});

type DeleteAllTransmittedDocumentsContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof deleteAllTransmittedDocumentsParamSchemaWithTeamId> }, out: { param: z.infer<typeof deleteAllTransmittedDocumentsParamSchemaWithTeamId> } }>;

const _deleteAllTransmittedDocuments = server.delete(
    "/:teamId/documents/all",
    requireTeamAccess(),
    requireDocumentAccess(),
    requirePermission("peppol.documents.delete"),
    describeRoute({hide: true}),
    zodValidator("param", deleteAllTransmittedDocumentsParamSchemaWithTeamId),
    _deleteAllTransmittedDocumentsImplementation,
);

const _deleteAllTransmittedDocumentsMinimal = server.delete(
    "/documents/all",
    requireTeamAccess(),
    requireDocumentAccess(),
    requirePermission("peppol.documents.delete"),
    describeRoute({hide: true}),
    _deleteAllTransmittedDocumentsImplementation,
);

async function _deleteAllTransmittedDocumentsImplementation(c: DeleteAllTransmittedDocumentsContext) {
    try {
        const extendedTeam = await getExtendedTeam(c.var.team.id);
        if (!extendedTeam?.isPlayground) {
            return c.json(actionFailure("This endpoint is only available for playground teams"), 403);
        }
        await deleteAllTransmittedDocuments(c.var.team.id);
        return c.json(actionSuccess());
    } catch (error) {
        return c.json(actionFailure("Failed to delete all documents"), 500);
    }
}

export type DeleteAllTransmittedDocuments = typeof _deleteAllTransmittedDocuments | typeof _deleteAllTransmittedDocumentsMinimal;

export default server;

