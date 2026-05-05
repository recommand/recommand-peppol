import {
  getCompanyIdentifiers,
} from "@peppol/data/company-identifiers";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { requireCompanyAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { companyIdentifierResponse } from "./shared";
import type { AuthenticatedUserContext, AuthenticatedTeamContext } from "@core/lib/auth-middleware";

const server = new Server();

const getIdentifiersRouteDescription = describeRoute({
  operationId: "getCompanyIdentifiers",
  description: "Get a list of all identifiers for a specific company",
  summary: "List Company Identifiers",
  tags: ["Company Identifiers"],
  responses: {
    ...describeSuccessResponseWithZod("Successfully retrieved company identifiers", z.object({ identifiers: z.array(companyIdentifierResponse) })),
    ...describeErrorResponse(500, "Failed to fetch company identifiers"),
  },
});

const getIdentifiersParamSchema = z.object({
  companyId: z.string().openapi({
    description: "The ID of the company to get identifiers for",
  }),
});

const getIdentifiersParamSchemaWithTeamId = getIdentifiersParamSchema.extend({ teamId: z.string() });

type GetIdentifiersContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getIdentifiersParamSchemaWithTeamId> }, out: { param: z.infer<typeof getIdentifiersParamSchemaWithTeamId> } }>;

const _getIdentifiersMinimal = server.get(
  "/companies/:companyId/identifiers",
  requireCompanyAccess(),
  getIdentifiersRouteDescription,
  zodValidator("param", getIdentifiersParamSchema),
  _getIdentifiersImplementation,
);

const _getIdentifiers = server.get(
  "/:teamId/companies/:companyId/identifiers",
  requireCompanyAccess(),
  describeRoute({hide: true}),
  zodValidator("param", getIdentifiersParamSchemaWithTeamId),
  _getIdentifiersImplementation,
);

async function _getIdentifiersImplementation(c: GetIdentifiersContext) {
  try {
    const identifiers = await getCompanyIdentifiers(c.var.company.id);
    return c.json(actionSuccess({ identifiers }));
  } catch (error) {
    return c.json(actionFailure("Could not fetch company identifiers"), 500);
  }
}

export type GetIdentifiers = typeof _getIdentifiers | typeof _getIdentifiersMinimal;

export default server;