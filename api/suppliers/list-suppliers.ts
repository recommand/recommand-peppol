import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
  getSuppliers,
} from "@peppol/data/suppliers";
import {
  describeErrorResponse,
  describeSuccessResponse,
  paginationQuery,
  paginationResponse,
} from "@core/lib/api-docs";
import { supplierResponse } from "./shared";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const getSuppliersRouteDescription = describeRoute({
  operationId: "getSuppliers",
  description: "Get a list of suppliers with pagination",
  summary: "List Suppliers",
  tags: ["Suppliers"],
  responses: {
    ...describeSuccessResponse("Successfully retrieved suppliers", z.object({
      suppliers: z.array(supplierResponse).openapi({ description: "The suppliers on this page." }),
      pagination: paginationResponse,
    })),
    ...describeErrorResponse(401, "Unauthorized"),
    ...describeErrorResponse(500, "Failed to fetch suppliers"),
  },
});

const getSuppliersQuerySchema = paginationQuery({ defaultLimit: 10, maxLimit: 100 }).extend({
  search: z.string().optional().openapi({
    description: "Search term to filter suppliers",
    examples: ["supplier name"],
  }),
});

const getSuppliersParamSchema = z.object({
  teamId: z.string(),
});

type GetSuppliersContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, {in: { query: z.input<typeof getSuppliersQuerySchema>, param: z.input<typeof getSuppliersParamSchema> }, out: { query: z.infer<typeof getSuppliersQuerySchema>, param: z.infer<typeof getSuppliersParamSchema> } }>;

const _getSuppliersMinimal = server.get(
    "/suppliers",
    requireIntegrationSupportedTeamAccess(),
    getSuppliersRouteDescription,
    zodValidator("query", getSuppliersQuerySchema),
    _getSuppliersImplementation,
);

const _getSuppliers = server.get(
    "/:teamId/suppliers",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("query", getSuppliersQuerySchema),
    zodValidator("param", getSuppliersParamSchema),
    _getSuppliersImplementation,
);

async function _getSuppliersImplementation(c: GetSuppliersContext) {
  try {
    const { page, limit, search } = c.req.valid("query");
    const { suppliers, total } = await getSuppliers(
      c.var.team.id,
      {
        page,
        limit,
        search,
      }
    );

    return c.json(
      actionSuccess({
        suppliers,
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
      actionFailure("Failed to fetch suppliers"),
      500
    );
  }
}

export type ListSuppliers =
  | typeof _getSuppliers
  | typeof _getSuppliersMinimal;

export default server;

