import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import { getSendingCompanyIdentifier } from "@peppol/data/company-identifiers";
import {
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import {
  DocumentType,
  sendDocumentSchema,
} from "@peppol/utils/parsing/send-document";
import { prepareJsonDocument } from "@peppol/utils/pipelines/sending/prepare-json-document";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure } from "@recommand/lib/utils";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { ulid } from "ulid";
import { z } from "zod";

const server = new Server();

const previewDocumentParamSchema = z.object({
  companyId: z.string(),
  type: z.enum(["html"]),
});

type PreviewDocumentContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: {
      param: z.input<typeof previewDocumentParamSchema>;
      json: z.input<typeof sendDocumentSchema>;
    };
    out: {
      param: z.infer<typeof previewDocumentParamSchema>;
      json: z.infer<typeof sendDocumentSchema>;
    };
  }
>;

const _previewDocument = server.post(
  "/:companyId/previewDocument/render/:type",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  describeRoute({ hide: true }),
  zodValidator("param", previewDocumentParamSchema),
  zodValidator("json", sendDocumentSchema),
  _previewDocumentImplementation,
);

async function _previewDocumentImplementation(c: PreviewDocumentContext) {
  try {
    const { type: outputType } = c.req.valid("param");
    if (outputType !== "html") {
      return c.json(actionFailure("Invalid preview type"), 400);
    }

    const input = c.req.valid("json");
    if (input.documentType === DocumentType.XML) {
      return c.json(
        actionFailure("Preview not available for raw XML documents."),
        400,
      );
    }

    const senderIdentifier = await getSendingCompanyIdentifier(
      c.var.company.id,
    );
    const senderAddress = `${senderIdentifier.scheme}:${senderIdentifier.identifier}`;
    let recipientAddress = input.recipient ?? "0000:0000";
    if (!recipientAddress.includes(":")) {
      recipientAddress = `0208:${recipientAddress.replace(/[^0-9]/g, "")}`;
    }

    const documentId = `draft_${ulid()}`;
    const prepared = await prepareJsonDocument({
      input: { ...input, pdfGeneration: undefined },
      company: c.var.company,
      senderAddress,
      recipientAddress,
      documentId,
      wrapContainer: false,
    });
    const documentType = getDocumentType(prepared.type);
    if (!documentType) {
      return c.json(
        actionFailure("Preview not available for this document."),
        400,
      );
    }

    return c.html(
      await documentType.render(
        prepared.parsed,
        { format: "html" },
        { documentId },
      ),
    );
  } catch (error) {
    return c.json(
      actionFailure(
        error instanceof Error ? error.message : "Failed to render preview",
      ),
      400,
    );
  }
}

export type PreviewDocument = typeof _previewDocument;
export default server;
