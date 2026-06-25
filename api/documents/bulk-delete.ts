import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { audit } from "@core/lib/audit";
import { deleteTransmittedDocuments } from "@peppol/data/transmitted-documents";
import { Server, type Context } from "@recommand/lib/api";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

const server = new Server();

const bulkDeleteParamSchema = z.object({
  teamId: z.string(),
});

const bulkDeleteJsonBodySchema = z.object({
  documentIds: z.array(z.string()).min(1).max(200),
});

type BulkDeleteContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext,
  string,
  {
    in: {
      param: z.input<typeof bulkDeleteParamSchema>;
      json: z.input<typeof bulkDeleteJsonBodySchema>;
    };
    out: {
      param: z.infer<typeof bulkDeleteParamSchema>;
      json: z.infer<typeof bulkDeleteJsonBodySchema>;
    };
  }
>;

const _bulkDelete = server.delete(
  "/:teamId/documents/bulk-delete",
  requireTeamAccess(),
  describeRoute({ hide: true }),
  zodValidator("param", bulkDeleteParamSchema),
  zodValidator("json", bulkDeleteJsonBodySchema),
  async (c: BulkDeleteContext) => {
    try {
      const { documentIds } = c.req.valid("json");
      await deleteTransmittedDocuments(c.var.team.id, documentIds);
      await audit(c, {
        action: "delete",
        subsystem: "peppol.documents",
        objectType: "peppol.document_batch",
        metadata: {
          documentIds,
          documentCount: documentIds.length,
        },
      });
      return c.json(actionSuccess());
    } catch (error) {
      if (error instanceof Error && error.message === "Document not found") {
        return c.json(actionFailure("Document not found"), 404);
      }

      return c.json(actionFailure("Failed to delete documents"), 500);
    }
  }
);

export type BulkDelete = typeof _bulkDelete;

export default server;
