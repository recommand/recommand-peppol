import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
  getTransmittedDocuments,
} from "@peppol/data/transmitted-documents";
import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { supportedDocumentTypeEnum } from "@peppol/db/schema";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { transmittedDocumentResponse } from "./shared";

const server = new Server();

const getTransmittedDocumentsRouteDescription = describeRoute({
  operationId: "getDocuments",
  description: "Get a list of transmitted documents with pagination",
  summary: "List Documents",
  tags: ["Documents"],
  responses: {
    ...describeSuccessResponseWithZod("Successfully retrieved transmitted documents", z.object({
      documents: z.array(transmittedDocumentResponse.omit({ xml: true })),
      pagination: z.object({
        total: z.number(),
        page: z.number(),
        limit: z.number(),
        totalPages: z.number(),
      }),
    })),
    ...describeErrorResponse(500, "Failed to fetch transmitted documents"),
  },
});

const getTransmittedDocumentsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1).openapi({
    description: "The page number to retrieve",
    example: 1,
  }),
  limit: z.coerce.number().min(1).max(200).default(10).openapi({
    description: "The number of items per page",
    example: 10,
  }),
  companyId: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .openapi({
      description: "Filter documents by company ID",
    }),
  labelId: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .openapi({
      description: "Filter documents by label ID",
    }),
  direction: z.enum(["incoming", "outgoing"]).optional().openapi({
    description: "Filter documents by direction (incoming or outgoing)",
    example: "incoming",
  }),
  search: z.string().optional().openapi({
    description: "Search term to filter documents",
    example: "invoice",
  }),
  type: z.enum(supportedDocumentTypeEnum.enumValues).optional().openapi({
    description: "Filter documents by type",
    example: "invoice",
  }),
  from: z.coerce.date().optional().openapi({
    description: "Filter documents created from this timestamp (inclusive). ISO 8601 format.",
    example: "2024-01-01T00:00:00Z",
  }),
  to: z.coerce.date().optional().openapi({
    description: "Filter documents created until this timestamp (exclusive). ISO 8601 format.",
    example: "2024-12-31T23:59:59Z",
  }),
  isUnread: z.enum(["true", "false"]).optional().openapi({
    description: "Filter documents by read status: true for unread documents (readAt is null), false for read documents.",
    example: "true",
  }),
  envelopeId: z.string().optional().openapi({
    description: "Filter documents by envelope ID (Standard Business Document Header Instance Identifier)",
  }),
  excludeAttachments: z
    .preprocess(
      (value) =>
        value === "true" ? true : value === "false" ? false : value,
      z.boolean()
    )
    .optional()
    .default(false)
    .openapi({
    description: "When true, excludes attachments from the parsed object to reduce payload size",
    example: false,
  }),
});

type GetTransmittedDocumentsContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, {in: { query: z.input<typeof getTransmittedDocumentsQuerySchema> }, out: { query: z.infer<typeof getTransmittedDocumentsQuerySchema> } }>;

const _transmittedDocumentsMinimal = server.get(
    "/documents",
    requireIntegrationSupportedTeamAccess(),
    getTransmittedDocumentsRouteDescription,
    zodValidator("query", getTransmittedDocumentsQuerySchema),
    _getTransmittedDocumentsImplementation,
);

const _transmittedDocuments = server.get(
    "/:teamId/documents",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("query", getTransmittedDocumentsQuerySchema),
    _getTransmittedDocumentsImplementation,
);

async function _getTransmittedDocumentsImplementation(c: GetTransmittedDocumentsContext) {
  try {
    const { page, limit, companyId, labelId, direction, search, type, from, to, isUnread, envelopeId, excludeAttachments } = c.req.valid("query");
    const { documents, total } = await getTransmittedDocuments(
      c.var.team.id,
      {
        page,
        limit,
        companyId: Array.isArray(companyId)
          ? companyId
          : companyId
            ? [companyId]
            : undefined,
        labelId: Array.isArray(labelId)
          ? labelId
          : labelId
            ? [labelId]
            : undefined,
        direction,
        search,
        type,
        from,
        to,
        isUnread: isUnread === "true" ? true : isUnread === "false" ? false : undefined,
        envelopeId,
        excludeAttachments,
      }
    );

    return c.json(
      actionSuccess({
        documents,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (error) {
    return c.json(
      actionFailure("Failed to fetch transmitted documents"),
      500
    );
  }
}

export type ListTransmittedDocuments =
  | typeof _transmittedDocuments
  | typeof _transmittedDocumentsMinimal;

export default server;
