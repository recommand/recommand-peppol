import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import { upsertCustomer } from "@peppol/data/customers";
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
import { customerResponse } from "./shared";
import { requireIntegrationSupportedTeamAccess, requirePermission } from "@peppol/utils/auth-middleware";

const server = new Server();

const upsertCustomerRouteDescription = describeRoute({
  operationId: "upsertCustomer",
  description:
    "Create or update a customer. If id is provided, updates by id. Otherwise, if externalId is provided, finds by externalId and updates or creates if not found. If neither is provided, creates a new customer.",
  summary: "Upsert Customer",
  tags: ["Customers"],
  responses: {
    ...describeSuccessResponse(
      "Successfully upserted customer",
      z.object({ customer: customerResponse.openapi({ description: "The customer, as created or updated." }) })
    ),
    ...describeErrorResponse(400, "Invalid request data"),
    ...describeErrorResponse(401, "Unauthorized"),
    ...describeErrorResponse(500, "Failed to upsert customer"),
  },
});

const upsertCustomerJsonBodySchema = z.object({
  id: z.string().optional().openapi({
    description:
      "The ID of the customer to update. When it does not match one of the team's customers, the request fails with a 400.",
  }),
  name: z.string().openapi({
    description: "The customer's name.",
  }),
  externalId: z.string().nullable().optional().openapi({
    description:
      "Your own identifier for the customer, unique within the team. Without an id, the customer with this external ID is updated, or created when there is none. With an id, it replaces the customer's external ID; null clears it, and leaving it out keeps it.",
  }),
  vatNumber: z.string().nullable().optional().openapi({
    description: "The customer's VAT number. Leaving it out on an update clears it.",
  }),
  enterpriseNumber: z.string().nullable().optional().openapi({
    description: "The customer's registration number in its national business register. Leaving it out on an update clears it.",
  }),
  peppolAddresses: z.array(z.string()).optional().default([]).openapi({
    description: "The customer's Peppol addresses, each as `scheme:identifier`. Leaving them out on an update clears them.",
  }),
  address: z.string().openapi({
    description: "Street name and number of the customer's address.",
  }),
  city: z.string().openapi({
    description: "City of the customer's address.",
  }),
  postalCode: z.string().openapi({
    description: "Postal code of the customer's address.",
  }),
  country: z.string().openapi({
    description: "The country of the customer's address, in ISO 3166-1 alpha-2 format.",
    examples: ["BE"],
  }),
  email: z.string().nullable().optional().openapi({
    description: "Contact email address for the customer. Leaving it out on an update clears it.",
  }),
  phone: z.string().nullable().optional().openapi({
    description: "Contact phone number for the customer. Leaving it out on an update clears it.",
  }),
});

const upsertCustomerParamSchema = z.object({
  teamId: z.string(),
});

type UpsertCustomerContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext,
  string,
  {
    in: {
      json: z.input<typeof upsertCustomerJsonBodySchema>;
      param: z.input<typeof upsertCustomerParamSchema>;
    };
    out: {
      json: z.infer<typeof upsertCustomerJsonBodySchema>;
      param: z.infer<typeof upsertCustomerParamSchema>;
    };
  }
>;

const _upsertCustomerMinimal = server.post(
  "/customers",
  requireIntegrationSupportedTeamAccess(),
  requirePermission("peppol.customers.write"),
  upsertCustomerRouteDescription,
  zodValidator("json", upsertCustomerJsonBodySchema),
  _upsertCustomerImplementation
);

const _upsertCustomer = server.post(
  "/:teamId/customers",
  requireIntegrationSupportedTeamAccess(),
  requirePermission("peppol.customers.write"),
  describeRoute({ hide: true }),
  zodValidator("param", upsertCustomerParamSchema),
  zodValidator("json", upsertCustomerJsonBodySchema),
  _upsertCustomerImplementation
);

async function _upsertCustomerImplementation(c: UpsertCustomerContext) {
  try {
    const data = c.req.valid("json");
    const customer = await upsertCustomer({
      ...data,
      teamId: c.var.team.id,
    });
    return c.json(actionSuccess({ customer }));
  } catch (error) {
    console.error(error);
    if (error instanceof UserFacingError) {
      return c.json(actionFailure(error), 400);
    }
    return c.json(actionFailure("Could not upsert customer"), 500);
  }
}

export type UpsertCustomer =
  | typeof _upsertCustomer
  | typeof _upsertCustomerMinimal;

export default server;
