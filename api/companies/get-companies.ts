import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
    getCompanies,
} from "@peppol/data/companies";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { companyResponse } from "./shared";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";

const server = new Server();

const getCompaniesRouteDescription = describeRoute({
    operationId: "getCompanies",
    description: "Get a list of all companies for a team",
    summary: "List Companies",
    tags: ["Companies"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved companies", z.object({ companies: z.array(companyResponse) })),
        ...describeErrorResponse(500, "Failed to fetch companies"),
    },
});

const getCompaniesQuerySchema = z.object({
    enterpriseNumber: z.string().optional().openapi({
        description: "Filter companies by enterprise number",
        example: "1234567894",
    }),
    vatNumber: z.string().optional().openapi({
        description: "Filter companies by VAT number",
        example: "BE1234567894",
    }),
});

const getCompaniesParamSchemaWithTeamId = z.object({
    teamId: z.string(),
});

type GetCompaniesContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getCompaniesParamSchemaWithTeamId>, query: z.input<typeof getCompaniesQuerySchema> }, out: { param: z.infer<typeof getCompaniesParamSchemaWithTeamId>, query: z.infer<typeof getCompaniesQuerySchema> } }>;

const _getCompaniesMinimal = server.get(
    "/companies",
    requireIntegrationSupportedTeamAccess(),
    getCompaniesRouteDescription,
    zodValidator("query", getCompaniesQuerySchema),
    _getCompaniesImplementation,
);

const _getCompanies = server.get(
    "/:teamId/companies",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getCompaniesParamSchemaWithTeamId),
    zodValidator("query", getCompaniesQuerySchema),
    _getCompaniesImplementation,
);

async function _getCompaniesImplementation(c: GetCompaniesContext) {
    try {
        const { enterpriseNumber, vatNumber } = c.req.valid("query");
        const allCompanies = await getCompanies(c.var.team.id, {
            enterpriseNumber,
            vatNumber,
        });
        return c.json(actionSuccess({ companies: allCompanies }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch companies"), 500);
    }
}

export type GetCompanies = typeof _getCompanies | typeof _getCompaniesMinimal;

export default server;