import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { getTransmittedDocumentsByIds } from "@peppol/data/transmitted-documents";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { Server, type Context } from "@recommand/lib/api";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { buildDocumentsArchive } from "./archive";

const server = new Server();

const bulkExportParamSchema = z.object({
  teamId: z.string(),
});

const bulkExportJsonBodySchema = z.object({
  documentIds: z.array(z.string()).min(1).max(200),
  outputType: z.enum(["flat", "nested"]),
  generatePdf: z.enum(["never", "always", "when_no_pdf_attachment"]).default("never"),
});

type BulkExportContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: {
      param: z.input<typeof bulkExportParamSchema>;
      json: z.input<typeof bulkExportJsonBodySchema>;
    };
    out: {
      param: z.infer<typeof bulkExportParamSchema>;
      json: z.infer<typeof bulkExportJsonBodySchema>;
    };
  }
>;

const _bulkExport = server.post(
  "/:teamId/documents/bulk-export",
  requireIntegrationSupportedTeamAccess(),
  describeRoute({ hide: true }),
  zodValidator("param", bulkExportParamSchema),
  zodValidator("json", bulkExportJsonBodySchema),
  async (c: BulkExportContext) => {
    try {
      const { documentIds, outputType, generatePdf } = c.req.valid("json");
      const documents = await getTransmittedDocumentsByIds(c.var.team.id, documentIds);

      if (documents.length === 0) {
        return c.json(actionFailure("No documents found"), 400);
      }

      const zipBuffer = await buildDocumentsArchive(documents, {
        outputType,
        generatePdf,
      });

      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", `attachment; filename="documents-selection.zip"`);

      return c.body(zipBuffer);
    } catch (error) {
      if (error instanceof Error && error.message === "Some documents were not found") {
        return c.json(actionFailure("Document not found"), 404);
      }

      return c.json(actionFailure("Failed to export documents"), 500);
    }
  }
);

export type BulkExport = typeof _bulkExport;

export default server;
