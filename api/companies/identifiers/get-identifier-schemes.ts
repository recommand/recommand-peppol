import { getCompanyIdentifierSchemeOptions } from "@peppol/data/company-identifier-policy";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { requireCompanyAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import type { AuthenticatedUserContext, AuthenticatedTeamContext } from "@core/lib/auth-middleware";

const server = new Server();

const getIdentifierSchemesRouteDescription = describeRoute({
  operationId: "getCompanyIdentifierSchemes",
  description: "The identifier schemes this company can register addresses under. Most companies can use any ISO/IEC 6523 scheme, in which case `supportedSchemes` is null. A company whose Peppol registration only accepts particular schemes, such as a French company, gets the list of schemes it accepts; an identifier under any other scheme is refused when created or updated.",
  summary: "Get Supported Identifier Schemes",
  tags: ["Company Identifiers"],
  responses: {
    ...describeSuccessResponseWithZod("Successfully retrieved the supported identifier schemes", z.object({
      supportedSchemes: z.array(z.string()).nullable().openapi({
        description: "The schemes the company can register identifiers under, or null when any scheme is accepted.",
        example: ["0225"],
      }),
    })),
    ...describeErrorResponse(500, "Failed to fetch supported identifier schemes"),
  },
});

const getIdentifierSchemesParamSchema = z.object({
  companyId: z.string().openapi({
    description: "The ID of the company to get the supported identifier schemes for",
  }),
});

const getIdentifierSchemesParamSchemaWithTeamId = getIdentifierSchemesParamSchema.extend({ teamId: z.string() });

type GetIdentifierSchemesContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getIdentifierSchemesParamSchemaWithTeamId> }, out: { param: z.infer<typeof getIdentifierSchemesParamSchemaWithTeamId> } }>;

const _getIdentifierSchemesMinimal = server.get(
  "/companies/:companyId/identifiers/schemes",
  requireCompanyAccess(),
  getIdentifierSchemesRouteDescription,
  zodValidator("param", getIdentifierSchemesParamSchema),
  _getIdentifierSchemesImplementation,
);

const _getIdentifierSchemes = server.get(
  "/:teamId/companies/:companyId/identifiers/schemes",
  requireCompanyAccess(),
  describeRoute({ hide: true }),
  zodValidator("param", getIdentifierSchemesParamSchemaWithTeamId),
  _getIdentifierSchemesImplementation,
);

async function _getIdentifierSchemesImplementation(c: GetIdentifierSchemesContext) {
  try {
    const supportedSchemes = getCompanyIdentifierSchemeOptions({
      smpProvider: c.var.company.smpProvider,
      isPlayground: c.var.team.isPlayground,
      useTestNetwork: c.var.team.useTestNetwork,
    });
    return c.json(actionSuccess({ supportedSchemes: supportedSchemes ? [...supportedSchemes] : null }));
  } catch {
    return c.json(actionFailure("Could not fetch supported identifier schemes"), 500);
  }
}

export type GetIdentifierSchemes = typeof _getIdentifierSchemes | typeof _getIdentifierSchemesMinimal;

export default server;
