import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
  upsertSupplier,
} from "@peppol/data/suppliers";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { UserFacingError } from "@peppol/utils/util";
import { supplierResponse } from "./shared";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const upsertSupplierRouteDescription = describeRoute({
  operationId: "upsertSupplier",
  description: "Create or update a supplier. If id is provided, updates by id. Otherwise, if externalId is provided, finds by externalId and updates or creates if not found. If neither is provided, creates a new supplier.",
  summary: "Upsert Supplier",
  tags: ["Suppliers"],
  responses: {
    ...describeSuccessResponseWithZod("Successfully upserted supplier", z.object({ supplier: supplierResponse })),
    ...describeErrorResponse(400, "Invalid request data"),
    ...describeErrorResponse(500, "Failed to upsert supplier"),
  },
});

const upsertSupplierJsonBodySchema = z.object({
  id: z.string().optional().openapi({
    description: "The internal ID of the supplier to update. If provided, updates by id.",
  }),
  name: z.string().openapi({
    description: "The name of the supplier",
  }),
  externalId: z.string().nullable().optional().openapi({
    description: "The external ID of the supplier. If provided without id, finds by externalId and updates or creates if not found.",
  }),
  vatNumber: z.string().nullable().optional().openapi({
    description: "The VAT number of the supplier",
  }),
  peppolAddresses: z.array(z.string()).optional().default([]).openapi({
    description: "The Peppol addresses of the supplier",
  }),
});

const upsertSupplierParamSchema = z.object({
  teamId: z.string(),
});

type UpsertSupplierContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { json: z.input<typeof upsertSupplierJsonBodySchema>, param: z.input<typeof upsertSupplierParamSchema> }, out: { json: z.infer<typeof upsertSupplierJsonBodySchema>, param: z.infer<typeof upsertSupplierParamSchema> } }>;

const _upsertSupplierMinimal = server.post(
  "/suppliers",
  requireIntegrationSupportedTeamAccess(),
  upsertSupplierRouteDescription,
  zodValidator("json", upsertSupplierJsonBodySchema),
  _upsertSupplierImplementation,
);

const _upsertSupplier = server.post(
  "/:teamId/suppliers",
  requireIntegrationSupportedTeamAccess(),
  describeRoute({hide: true}),
  zodValidator("param", upsertSupplierParamSchema),
  zodValidator("json", upsertSupplierJsonBodySchema),
  _upsertSupplierImplementation,
);

async function _upsertSupplierImplementation(c: UpsertSupplierContext) {
  try {
    const data = c.req.valid("json");
    const supplier = await upsertSupplier({
      ...data,
      teamId: c.var.team.id,
    });
    return c.json(actionSuccess({ supplier }));
  } catch (error) {
    console.error(error);
    if (error instanceof UserFacingError) {
      return c.json(actionFailure(error), 400);
    }
    return c.json(actionFailure("Could not upsert supplier"), 500);
  }
}

export type UpsertSupplier = typeof _upsertSupplier | typeof _upsertSupplierMinimal;

export default server;

