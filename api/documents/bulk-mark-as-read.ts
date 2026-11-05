import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { markDocumentsAsRead } from "@peppol/data/transmitted-documents";
import { requireDocumentAccess, requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { Server, type Context } from "@recommand/lib/api";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

const server = new Server();

const bulkMarkAsReadParamSchema = z.object({
  teamId: z.string(),
});

const bulkMarkAsReadJsonBodySchema = z.object({
  documentIds: z.array(z.string()).min(1).max(200),
  read: z.boolean().optional().default(true),
});

type BulkMarkAsReadContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: {
      param: z.input<typeof bulkMarkAsReadParamSchema>;
      json: z.input<typeof bulkMarkAsReadJsonBodySchema>;
    };
    out: {
      param: z.infer<typeof bulkMarkAsReadParamSchema>;
      json: z.infer<typeof bulkMarkAsReadJsonBodySchema>;
    };
  }
>;

const _bulkMarkAsRead = server.post(
  "/:teamId/documents/bulk-mark-as-read",
  requireIntegrationSupportedTeamAccess(),
  requireDocumentAccess(),
  describeRoute({ hide: true }),
  zodValidator("param", bulkMarkAsReadParamSchema),
  zodValidator("json", bulkMarkAsReadJsonBodySchema),
  async (c: BulkMarkAsReadContext) => {
    try {
      const { documentIds, read = true } = c.req.valid("json");
      await markDocumentsAsRead(c.var.team.id, documentIds, read);
      return c.json(actionSuccess());
    } catch (error) {
      if (error instanceof Error && error.message === "Document not found") {
        return c.json(actionFailure("Document not found"), 404);
      }

      return c.json(actionFailure("Failed to update document read status"), 500);
    }
  }
);

export type BulkMarkAsRead = typeof _bulkMarkAsRead;

export default server;
