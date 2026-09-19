import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { getCompany } from "@peppol/data/companies";
import { getEnterpriseData } from "@peppol/data/cbe-public-search/client";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import type { CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { UserFacingError } from "@peppol/utils/util";

const server = new Server();

const enterpriseDataParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to get enterprise data for",
    }),
    teamId: z.string(),
});

type EnterpriseDataContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof enterpriseDataParamSchema> }, out: { param: z.infer<typeof enterpriseDataParamSchema> } }>;

const _getCompanyEnterpriseData = server.get(
    "/:teamId/companies/:companyId/enterprise-data",
    requireTeamAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", enterpriseDataParamSchema),
    _getCompanyEnterpriseDataImplementation,
);

async function _getCompanyEnterpriseDataImplementation(c: EnterpriseDataContext) {
    try {
        const companyId = c.req.valid("param").companyId;
        const teamId = c.var.team.id;
        
        const company = await getCompany(teamId, companyId);
        if (!company) {
            return c.json(actionFailure("Company not found"), 404);
        }

        if (!company.enterpriseNumber) {
            return c.json(actionFailure("Company does not have an enterprise number"), 400);
        }

        if (company.country !== "BE") {
            return c.json(actionFailure("Enterprise data is only available for Belgian companies for now"), 400);
        }

        const enterpriseData = await getEnterpriseData(company.enterpriseNumber, company.country);
        return c.json(actionSuccess(enterpriseData));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not fetch enterprise data"), 500);
    }
}

export type GetCompanyEnterpriseData = typeof _getCompanyEnterpriseData;

export default server;
