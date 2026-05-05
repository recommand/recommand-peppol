import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
  deleteSupplier,
} from "@peppol/data/suppliers";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";
import { UserFacingError } from "@peppol/utils/util";
import { supplierIdParamSchema } from "./shared";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const deleteSupplierRouteDescription = describeRoute({
  operationId: "deleteSupplier",
  description: "Delete a supplier",
  summary: "Delete Supplier",
  tags: ["Suppliers"],
  responses: {
    ...describeSuccessResponse("Successfully deleted supplier"),
    ...describeErrorResponse(400, "Invalid request data"),
    ...describeErrorResponse(500, "Failed to delete supplier"),
  },
});

const deleteSupplierParamSchemaWithTeamId = supplierIdParamSchema.extend({
  teamId: z.string(),
});

type DeleteSupplierContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof deleteSupplierParamSchemaWithTeamId> }, out: { param: z.infer<typeof deleteSupplierParamSchemaWithTeamId> } }>;

const _deleteSupplierMinimal = server.delete(
  "/suppliers/:supplierId",
  requireIntegrationSupportedTeamAccess(),
  deleteSupplierRouteDescription,
  zodValidator("param", supplierIdParamSchema),
  _deleteSupplierImplementation,
);

const _deleteSupplier = server.delete(
  "/:teamId/suppliers/:supplierId",
  requireIntegrationSupportedTeamAccess(),
  describeRoute({hide: true}),
  zodValidator("param", deleteSupplierParamSchemaWithTeamId),
  _deleteSupplierImplementation,
);

async function _deleteSupplierImplementation(c: DeleteSupplierContext) {
  try {
    const { supplierId } = c.req.valid("param");
    await deleteSupplier(c.var.team.id, supplierId);
    return c.json(actionSuccess());
  } catch (error) {
    console.error(error);
    if (error instanceof UserFacingError) {
      return c.json(actionFailure(error), 400);
    }
    return c.json(actionFailure("Could not delete supplier"), 500);
  }
}

export type DeleteSupplier = typeof _deleteSupplier | typeof _deleteSupplierMinimal;

export default server;

