import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import { getCustomers } from "@peppol/data/customers";
import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { customerResponse } from "./shared";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const getCustomersRouteDescription = describeRoute({
  operationId: "getCustomers",
  description: "Get a list of customers with pagination",
  summary: "List Customers",
  tags: ["Customers"],
  responses: {
    ...describeSuccessResponseWithZod(
      "Successfully retrieved customers",
      z.object({
        customers: z.array(customerResponse),
        pagination: z.object({
          total: z.number(),
          page: z.number(),
          limit: z.number(),
          totalPages: z.number(),
        }),
      })
    ),
    ...describeErrorResponse(500, "Failed to fetch customers"),
  },
});

const getCustomersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1).openapi({
    description: "The page number to retrieve",
    example: 1,
  }),
  limit: z.coerce.number().min(1).max(100).default(10).openapi({
    description: "The number of items per page",
    example: 10,
  }),
  search: z.string().optional().openapi({
    description: "Search term to filter customers",
    example: "customer name",
  }),
});

const getCustomersParamSchema = z.object({
  teamId: z.string(),
});

type GetCustomersContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext,
  string,
  {
    in: {
      query: z.input<typeof getCustomersQuerySchema>;
      param: z.input<typeof getCustomersParamSchema>;
    };
    out: {
      query: z.infer<typeof getCustomersQuerySchema>;
      param: z.infer<typeof getCustomersParamSchema>;
    };
  }
>;

const _getCustomersMinimal = server.get(
  "/customers",
  requireIntegrationSupportedTeamAccess(),
  getCustomersRouteDescription,
  zodValidator("query", getCustomersQuerySchema),
  _getCustomersImplementation
);

const _getCustomers = server.get(
  "/:teamId/customers",
  requireIntegrationSupportedTeamAccess(),
  describeRoute({ hide: true }),
  zodValidator("query", getCustomersQuerySchema),
  zodValidator("param", getCustomersParamSchema),
  _getCustomersImplementation
);

async function _getCustomersImplementation(c: GetCustomersContext) {
  try {
    const { page, limit, search } = c.req.valid("query");
    const { customers, total } = await getCustomers(c.var.team.id, {
      page,
      limit,
      search,
    });

    return c.json(
      actionSuccess({
        customers,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (error) {
    return c.json(actionFailure("Failed to fetch customers"), 500);
  }
}

export type ListCustomers = typeof _getCustomers | typeof _getCustomersMinimal;

export default server;
