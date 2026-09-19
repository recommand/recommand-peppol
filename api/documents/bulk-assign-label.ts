import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { assignLabelToDocuments } from "@peppol/data/document-labels";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { UserFacingError } from "@peppol/utils/util";
import { Server, type Context } from "@recommand/lib/api";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

const server = new Server();

const bulkAssignLabelParamSchema = z.object({
  teamId: z.string(),
  labelId: z.string(),
});

const bulkAssignLabelJsonBodySchema = z.object({
  documentIds: z.array(z.string()).min(1).max(200),
});

type BulkAssignLabelContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: {
      param: z.input<typeof bulkAssignLabelParamSchema>;
      json: z.input<typeof bulkAssignLabelJsonBodySchema>;
    };
    out: {
      param: z.infer<typeof bulkAssignLabelParamSchema>;
      json: z.infer<typeof bulkAssignLabelJsonBodySchema>;
    };
  }
>;

const _bulkAssignLabel = server.post(
  "/:teamId/documents/bulk-assign-label/:labelId",
  requireIntegrationSupportedTeamAccess(),
  describeRoute({ hide: true }),
  zodValidator("param", bulkAssignLabelParamSchema),
  zodValidator("json", bulkAssignLabelJsonBodySchema),
  async (c: BulkAssignLabelContext) => {
    try {
      const { labelId } = c.req.valid("param");
      const { documentIds } = c.req.valid("json");

      await assignLabelToDocuments(c.var.team.id, documentIds, labelId);

      return c.json(actionSuccess({}));
    } catch (error) {
      if (error instanceof UserFacingError) {
        return c.json(actionFailure(error), 404);
      }

      return c.json(actionFailure("Could not assign label"), 500);
    }
  }
);

export type BulkAssignLabel = typeof _bulkAssignLabel;

export default server;
