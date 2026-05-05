import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import { deleteCustomer } from "@peppol/data/customers";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import {
  describeErrorResponse,
  describeSuccessResponse,
} from "@core/lib/api-docs";
import { UserFacingError } from "@peppol/utils/util";
import { customerIdParamSchema } from "./shared";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const deleteCustomerRouteDescription = describeRoute({
  operationId: "deleteCustomer",
  description: "Delete a customer",
  summary: "Delete Customer",
  tags: ["Customers"],
  responses: {
    ...describeSuccessResponse("Successfully deleted customer"),
    ...describeErrorResponse(400, "Invalid request data"),
    ...describeErrorResponse(500, "Failed to delete customer"),
  },
});

const deleteCustomerParamSchemaWithTeamId = customerIdParamSchema.extend({
  teamId: z.string(),
});

type DeleteCustomerContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext,
  string,
  {
    in: { param: z.input<typeof deleteCustomerParamSchemaWithTeamId> };
    out: { param: z.infer<typeof deleteCustomerParamSchemaWithTeamId> };
  }
>;

const _deleteCustomerMinimal = server.delete(
  "/customers/:customerId",
  requireIntegrationSupportedTeamAccess(),
  deleteCustomerRouteDescription,
  zodValidator("param", customerIdParamSchema),
  _deleteCustomerImplementation
);

const _deleteCustomer = server.delete(
  "/:teamId/customers/:customerId",
  requireIntegrationSupportedTeamAccess(),
  describeRoute({ hide: true }),
  zodValidator("param", deleteCustomerParamSchemaWithTeamId),
  _deleteCustomerImplementation
);

async function _deleteCustomerImplementation(c: DeleteCustomerContext) {
  try {
    const { customerId } = c.req.valid("param");
    await deleteCustomer(c.var.team.id, customerId);
    return c.json(actionSuccess());
  } catch (error) {
    console.error(error);
    if (error instanceof UserFacingError) {
      return c.json(actionFailure(error), 400);
    }
    return c.json(actionFailure("Could not delete customer"), 500);
  }
}

export type DeleteCustomer =
  | typeof _deleteCustomer
  | typeof _deleteCustomerMinimal;

export default server;
