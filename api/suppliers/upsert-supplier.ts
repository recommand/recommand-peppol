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
import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";
import { UserFacingError } from "@peppol/utils/util";
import { supplierResponse } from "./shared";
import { requireIntegrationSupportedTeamAccess, requirePermission } from "@peppol/utils/auth-middleware";

const server = new Server();

const upsertSupplierRouteDescription = describeRoute({
  operationId: "upsertSupplier",
  description: "Create or update a supplier. If id is provided, updates by id. Otherwise, if externalId is provided, finds by externalId and updates or creates if not found. If neither is provided, creates a new supplier.",
  summary: "Upsert Supplier",
  tags: ["Suppliers"],
  responses: {
    ...describeSuccessResponse("Successfully upserted supplier", z.object({ supplier: supplierResponse.openapi({ description: "The supplier, as created or updated." }) })),
    ...describeErrorResponse(400, "Invalid request data"),
    ...describeErrorResponse(401, "Unauthorized"),
    ...describeErrorResponse(500, "Failed to upsert supplier"),
  },
});

const upsertSupplierJsonBodySchema = z.object({
  id: z.string().optional().openapi({
    description: "The ID of the supplier to update. When it does not match one of the team's suppliers, the request fails with a 400.",
  }),
  name: z.string().openapi({
    description: "The supplier's name.",
  }),
  externalId: z.string().nullable().optional().openapi({
    description: "Your own identifier for the supplier, unique within the team. Without an id, the supplier with this external ID is updated, or created when there is none. With an id, it replaces the supplier's external ID; null clears it, and leaving it out keeps it.",
  }),
  vatNumber: z.string().nullable().optional().openapi({
    description: "The supplier's VAT number. An incoming invoice or credit note whose seller has exactly this VAT number is matched to the supplier. Leaving it out on an update clears it.",
  }),
  peppolAddresses: z.array(z.string()).optional().default([]).openapi({
    description: "The supplier's Peppol addresses, each as `scheme:identifier`. An incoming invoice or credit note sent from one of these addresses is matched to the supplier. Leaving them out on an update clears them.",
  }),
});

const upsertSupplierParamSchema = z.object({
  teamId: z.string(),
});

type UpsertSupplierContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { json: z.input<typeof upsertSupplierJsonBodySchema>, param: z.input<typeof upsertSupplierParamSchema> }, out: { json: z.infer<typeof upsertSupplierJsonBodySchema>, param: z.infer<typeof upsertSupplierParamSchema> } }>;

const _upsertSupplierMinimal = server.post(
  "/suppliers",
  requireIntegrationSupportedTeamAccess(),
  requirePermission("peppol.suppliers.write"),
  upsertSupplierRouteDescription,
  zodValidator("json", upsertSupplierJsonBodySchema),
  _upsertSupplierImplementation,
);

const _upsertSupplier = server.post(
  "/:teamId/suppliers",
  requireIntegrationSupportedTeamAccess(),
  requirePermission("peppol.suppliers.write"),
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

