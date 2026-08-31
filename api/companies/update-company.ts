import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
    updateCompany,
} from "@peppol/data/companies";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { companyResponse, toCompanyResponse } from "@peppol/api/companies/shared";
import type { CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { cleanEnterpriseNumber, cleanVatNumber, UserFacingError } from "@directory/utils/util";
import { zodValidCountryCodes } from "@peppol/db/schema";
import { zodValidIsoIcdSchemeIdentifiers } from "@peppol/utils/iso-icd-scheme-identifiers";
import { audit } from "@core/lib/audit";

const server = new Server();

const updateCompanyRouteDescription = describeRoute({
    operationId: "updateCompany",
    description: "Update an existing company. Changing the VAT number or enterprise number revokes any open verification sessions for the company. If the company was already verified, its verification status is also revoked and the company must be verified again.",
    summary: "Update Company",
    tags: ["Companies"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully updated company", z.object({ company: companyResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(404, "Company not found"),
        ...describeErrorResponse(500, "Failed to update company"),
    },
});

const updateCompanyParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to update",
    }),
});

const updateCompanyParamSchemaWithTeamId = updateCompanyParamSchema.extend({
    teamId: z.string(),
});

const updateCompanyJsonBodySchema = z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    country: zodValidCountryCodes.optional(),
    enterpriseNumberScheme: zodValidIsoIcdSchemeIdentifiers.nullish(),
    enterpriseNumber: z.string().nullish().transform(cleanEnterpriseNumber).openapi({
        description: "The enterprise number of the company. Changing its value revokes open verification sessions, and also revokes verification status if the company was verified.",
    }),
    vatNumber: z.string().nullish().transform(cleanVatNumber).openapi({
        description: "The VAT number of the company. Changing its value revokes open verification sessions, and also revokes verification status if the company was verified.",
    }),
    email: z.string().email().or(z.literal("")).nullish().transform((val) => val?.trim() === "" ? null : val),
    phone: z.string().nullish().transform((val) => val?.trim() === "" ? null : val),
    isSmpRecipient: z.boolean().optional(),
});

type UpdateCompanyContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof updateCompanyParamSchemaWithTeamId>, json: z.input<typeof updateCompanyJsonBodySchema> }, out: { param: z.infer<typeof updateCompanyParamSchemaWithTeamId>, json: z.infer<typeof updateCompanyJsonBodySchema> } }>;

const _updateCompanyMinimal = server.put(
    "/companies/:companyId",
    requireTeamAccess(),
    updateCompanyRouteDescription,
    zodValidator("param", updateCompanyParamSchema),
    zodValidator("json", updateCompanyJsonBodySchema),
    _updateCompanyImplementation,
);

const _updateCompany = server.put(
    "/:teamId/companies/:companyId",
    requireTeamAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", updateCompanyParamSchemaWithTeamId),
    zodValidator("json", updateCompanyJsonBodySchema),
    _updateCompanyImplementation,
);

async function _updateCompanyImplementation(c: UpdateCompanyContext) {
    try {
        const updateData = c.req.valid("json");

        const company = await updateCompany({
            ...updateData,
            teamId: c.var.team.id,
            id: c.req.valid("param").companyId,
        });
        if (!company) {
            return c.json(actionFailure("Company not found"), 404);
        }
        await audit(c, {
            action: "update",
            subsystem: "peppol.companies",
            objectType: "peppol.company",
            objectId: company.id,
            after: {
                name: company.name,
                address: company.address,
                postalCode: company.postalCode,
                city: company.city,
                country: company.country,
                enterpriseNumberScheme: company.enterpriseNumberScheme,
                enterpriseNumber: company.enterpriseNumber,
                vatNumber: company.vatNumber,
                email: company.email,
                phone: company.phone,
                isSmpRecipient: company.isSmpRecipient,
            },
            metadata: { changedFields: Object.keys(updateData) },
        });
        return c.json(actionSuccess({ company: toCompanyResponse(company) }));
    } catch (error) {
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        console.error(error);
        return c.json(actionFailure("Could not update company"), 500);
    }
}

export type UpdateCompany = typeof _updateCompany | typeof _updateCompanyMinimal;

export default server;
