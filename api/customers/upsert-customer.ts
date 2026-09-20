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
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { UserFacingError } from "@peppol/utils/util";
import { customerResponse } from "./shared";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const upsertCustomerRouteDescription = describeRoute({
  operationId: "upsertCustomer",
  description:
    "Create or update a customer. If id is provided, updates by id. Otherwise, if externalId is provided, finds by externalId and updates or creates if not found. If neither is provided, creates a new customer.",
  summary: "Upsert Customer",
  tags: ["Customers"],
  responses: {
    ...describeSuccessResponseWithZod(
      "Successfully upserted customer",
      z.object({ customer: customerResponse })
    ),
    ...describeErrorResponse(400, "Invalid request data"),
    ...describeErrorResponse(500, "Failed to upsert customer"),
  },
});

const upsertCustomerJsonBodySchema = z.object({
  id: z.string().optional().openapi({
    description:
      "The internal ID of the customer to update. If provided, updates by id.",
  }),
  name: z.string().openapi({
    description: "The name of the customer",
  }),
  externalId: z.string().nullable().optional().openapi({
    description:
      "The external ID of the customer. If provided without id, finds by externalId and updates or creates if not found.",
  }),
  vatNumber: z.string().nullable().optional().openapi({
    description: "The VAT number of the customer",
  }),
  enterpriseNumber: z.string().nullable().optional().openapi({
    description: "The enterprise number of the customer",
  }),
  peppolAddresses: z.array(z.string()).optional().default([]).openapi({
    description: "The Peppol addresses of the customer",
  }),
  address: z.string().openapi({
    description: "The street address of the customer",
  }),
  city: z.string().openapi({
    description: "The city of the customer",
  }),
  postalCode: z.string().openapi({
    description: "The postal code of the customer",
  }),
  country: z.string().openapi({
    description: "The country code (ISO 3166-1 alpha-2) of the customer",
    example: "BE",
  }),
  email: z.string().nullable().optional().openapi({
    description: "The email address of the customer",
  }),
  phone: z.string().nullable().optional().openapi({
    description: "The phone number of the customer",
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
  upsertCustomerRouteDescription,
  zodValidator("json", upsertCustomerJsonBodySchema),
  _upsertCustomerImplementation
);

const _upsertCustomer = server.post(
  "/:teamId/customers",
  requireIntegrationSupportedTeamAccess(),
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
