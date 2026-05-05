import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import {
  requireTeamAccess,
  type AuthenticatedTeamContext,
  type AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
  getTransmittedDocument,
} from "@peppol/data/transmitted-documents";
import type { CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { renderDocumentHtml, renderDocumentPdf } from "@peppol/utils/document-renderer";
import { describeErrorResponse } from "@core/lib/api-docs";

const server = new Server();

const renderDocumentRouteDescription = describeRoute({
  operationId: "renderDocument",
  description: "Render a document preview as HTML or PDF",
  summary: "Render Document Preview",
  tags: ["Documents"],
  responses: {
    [200]: {
      description: "Successfully rendered the document",
      content: {
        "text/html": {
          schema: {
            type: "string",
          },
        },
        "application/pdf": {
          schema: {
            type: "string",
            format: "binary",
          },
        },
      },
    },
    ...describeErrorResponse(404, "Document not found"),
    ...describeErrorResponse(500, "Failed to render document"),
  },
});

const renderDocumentParamSchema = z.object({
  documentId: z.string().openapi({
    description: "The ID of the document to render",
  }),
  type: z.enum(["html", "pdf"]).openapi({
    description: "The type of the document to render",
    example: "html",
  }),
});

const renderDocumentParamSchemaWithTeamId = renderDocumentParamSchema.extend({
  teamId: z.string(),
});

type RenderDocumentContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: { param: z.input<typeof renderDocumentParamSchemaWithTeamId> };
    out: { param: z.infer<typeof renderDocumentParamSchemaWithTeamId> };
  }
>;

const _renderDocumentMinimal = server.get(
  "/documents/:documentId/render/:type",
  requireTeamAccess(),
  renderDocumentRouteDescription,
  zodValidator("param", renderDocumentParamSchema),
  _renderDocumentImplementation,
);

const _renderDocument = server.get(
  "/:teamId/documents/:documentId/render/:type",
  requireTeamAccess(),
  describeRoute({ hide: true }),
  zodValidator("param", renderDocumentParamSchemaWithTeamId),
  _renderDocumentImplementation,
);

async function _renderDocumentImplementation(c: RenderDocumentContext) {
  try {
    const { documentId, type } = c.req.valid("param");
    const document = await getTransmittedDocument(c.var.team.id, documentId);

    if (!document) {
      return c.json(actionFailure("Document not found"), 404);
    }

    if (type === "html") {
      const html = await renderDocumentHtml(document);
      return c.html(html);
    } else if (type === "pdf") {
      const pdf = await renderDocumentPdf(document);
      c.header("Content-Type", "application/pdf");
      c.header("Content-Disposition", `attachment; filename="${documentId}.pdf"`);
      return c.body(pdf);
    } else {
      return c.json(actionFailure("Invalid document type"), 400);
    }
  } catch (error) {
    console.error("Failed to render document HTML:", error);
    return c.json(actionFailure("Failed to render document"), 500);
  }
}

export type RenderDocument =
  | typeof _renderDocument
  | typeof _renderDocumentMinimal;

export default server;


