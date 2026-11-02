import { Server } from "@recommand/lib/api";
import { actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import "zod-openapi/extend";
import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";
import { requireAuth } from "@core/lib/auth-middleware";
import { aiIntakeTypes, intakeTypeKeys } from "@peppol/utils/pipelines/intake/document-types";

// The document types document intake can produce, for the dashboard: each type with a
// registered XML format, and whether AI can also extract it from a PDF. The `aiIntake`
// flag of a document type decides the second part, so the dashboard follows it.

const server = new Server();

const intakeDocumentTypeSchema = z
  .object({
    key: z.string().openapi({ description: "The document type." }),
    aiIntake: z.boolean().openapi({ description: "Whether AI can recognise and extract the type from a PDF." }),
  })
  .openapi({ ref: "IntakeDocumentTypeSupport" });

const _getIntakeDocumentTypes = server.get(
  "/intakeDocumentTypes",
  requireAuth(),
  describeRoute({
    hide: true,
    operationId: "getIntakeDocumentTypes",
    summary: "List the document types of document intake",
    tags: ["Imports"],
    responses: {
      ...describeSuccessResponse(
        "The document types an import can produce",
        z.object({ documentTypes: z.array(intakeDocumentTypeSchema) }),
      ),
      ...describeErrorResponse(401, "Unauthorized"),
    },
  }),
  (c) => {
    const ai = new Set<string>(aiIntakeTypes().map((type) => type.key));
    return c.json(actionSuccess({ documentTypes: intakeTypeKeys().map((key) => ({ key, aiIntake: ai.has(key) })) }));
  },
);

export type IntakeDocumentTypes = typeof _getIntakeDocumentTypes;

export default server;
