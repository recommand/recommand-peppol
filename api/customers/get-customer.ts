import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import { getCustomerByIdOrExternalId } from "@peppol/data/customers";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { UserFacingError } from "@peppol/utils/util";
import { customerResponse, customerIdParamSchema } from "./shared";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const getCustomerRouteDescription = describeRoute({
  operationId: "getCustomer",
  description:
    "Get a customer by ID or external ID. The customerId parameter works with both internal and external IDs.",
  summary: "Get Customer",
  tags: ["Customers"],
  responses: {
    ...describeSuccessResponseWithZod(
      "Successfully retrieved customer",
      z.object({ customer: customerResponse })
    ),
    ...describeErrorResponse(404, "Customer not found"),
    ...describeErrorResponse(500, "Failed to fetch customer"),
  },
});

const getCustomerParamSchemaWithTeamId = customerIdParamSchema.extend({
  teamId: z.string(),
});

type GetCustomerContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext,
  string,
  {
    in: { param: z.input<typeof getCustomerParamSchemaWithTeamId> };
    out: { param: z.infer<typeof getCustomerParamSchemaWithTeamId> };
  }
>;

const _getCustomerMinimal = server.get(
  "/customers/:customerId",
  requireIntegrationSupportedTeamAccess(),
  getCustomerRouteDescription,
  zodValidator("param", customerIdParamSchema),
  _getCustomerImplementation
);

const _getCustomer = server.get(
  "/:teamId/customers/:customerId",
  requireIntegrationSupportedTeamAccess(),
  describeRoute({ hide: true }),
  zodValidator("param", getCustomerParamSchemaWithTeamId),
  _getCustomerImplementation
);

async function _getCustomerImplementation(c: GetCustomerContext) {
  try {
    const { customerId } = c.req.valid("param");
    const teamId = c.var.team.id;

    const customer = await getCustomerByIdOrExternalId(teamId, customerId);

    if (!customer) {
      return c.json(
        actionFailure(new UserFacingError("Customer not found")),
        404
      );
    }

    return c.json(actionSuccess({ customer }));
  } catch (error) {
    console.error(error);
    if (error instanceof UserFacingError) {
      return c.json(actionFailure(error), 404);
    }
    return c.json(actionFailure("Could not fetch customer"), 500);
  }
}

export type GetCustomer = typeof _getCustomer | typeof _getCustomerMinimal;

export default server;
