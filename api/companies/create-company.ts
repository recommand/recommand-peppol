import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
    createCompany,
    deleteCompany,
} from "@peppol/data/companies";
import { createCompanyVerificationLog, getBaseUrlOrThrow } from "@peppol/data/company-verification";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { companyResponse } from "./shared";
import type { CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { cleanEnterpriseNumber, cleanVatNumber, UserFacingError } from "@peppol/utils/util";
import { zodValidCountryCodes } from "@peppol/db/schema";
import { zodValidIsoIcdSchemeIdentifiers } from "@peppol/utils/iso-icd-scheme-identifiers";
import { audit } from "@core/lib/audit";

const server = new Server();

const createCompanyRouteDescription = describeRoute({
    operationId: "createCompany",
    description: "Create a new company",
    summary: "Create Company",
    tags: ["Companies"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully created company", z.object({ company: companyResponse, verificationUrl: z.string() })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(500, "Failed to create company"),
    },
});

const createCompanyJsonBodySchema = z.object({
    name: z.string(),
    address: z.string(),
    postalCode: z.string(),
    city: z.string(),
    country: zodValidCountryCodes,
    enterpriseNumberScheme: zodValidIsoIcdSchemeIdentifiers.nullish(),
    enterpriseNumber: z.string().nullish().transform(cleanEnterpriseNumber).openapi({ description: "The enterprise number of the company. Can only contain alphanumeric characters. For Belgian businesses it will be inferred from the VAT number if not provided." }),
    vatNumber: z.string().nullish().transform(cleanVatNumber),
    email: z.string().email().or(z.literal("")).nullish().transform((val) => val?.trim() === "" ? null : val),
    phone: z.string().nullish().transform((val) => val?.trim() === "" ? null : val),
    isSmpRecipient: z.boolean().default(true),
    skipDefaultCompanySetup: z.boolean().default(false).openapi({ description: "If true, the automatic creation of company identifiers and document types will be skipped. You will need to create them afterwards using the company identifier creation endpoint and company document type creation endpoint." }),
});

const createCompanyParamSchemaWithTeamId = z.object({
    teamId: z.string(),
});

type CreateCompanyContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof createCompanyParamSchemaWithTeamId>, json: z.input<typeof createCompanyJsonBodySchema> }, out: { param: z.infer<typeof createCompanyParamSchemaWithTeamId>, json: z.infer<typeof createCompanyJsonBodySchema> } }>;

const _createCompanyMinimal = server.post(
    "/companies",
    requireTeamAccess(),
    createCompanyRouteDescription,
    zodValidator("json", createCompanyJsonBodySchema),
    _createCompanyImplementation,
);

const _createCompany = server.post(
    "/:teamId/companies",
    requireTeamAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", createCompanyParamSchemaWithTeamId),
    zodValidator("json", createCompanyJsonBodySchema),
    _createCompanyImplementation,
);

async function _createCompanyImplementation(c: CreateCompanyContext) {
    let enterpriseNumber = c.req.valid("json").enterpriseNumber;
    let enterpriseNumberScheme = c.req.valid("json").enterpriseNumberScheme;
    if (!enterpriseNumber && c.req.valid("json").vatNumber && c.req.valid("json").country === "BE") {
        // If the country is Belgium and the vat number is provided, we can use the vat number to autogenerate the enterprise number
        enterpriseNumber = cleanEnterpriseNumber(c.req.valid("json").vatNumber!);
        if(!enterpriseNumberScheme){
            enterpriseNumberScheme = "0208";
        }
        if (enterpriseNumber?.startsWith("BE")) {
            enterpriseNumber = enterpriseNumber.slice(2);
        }
    }

    try {
        getBaseUrlOrThrow();

        const company = await createCompany({
            ...c.req.valid("json"),
            teamId: c.var.team.id,
            enterpriseNumber,
            enterpriseNumberScheme,
        });

        try {
            const { log, verificationUrl } = await createCompanyVerificationLog({
                teamId: c.var.team.id,
                companyId: company.id,
            });
            await audit(c, {
                action: "create",
                subsystem: "peppol.companies",
                objectType: "peppol.company",
                objectId: company.id,
                after: {
                    name: company.name,
                    country: company.country,
                    enterpriseNumberScheme: company.enterpriseNumberScheme,
                    enterpriseNumber: company.enterpriseNumber,
                    vatNumber: company.vatNumber,
                    isSmpRecipient: company.isSmpRecipient,
                },
                metadata: { verificationLogId: log.id },
            });

            return c.json(actionSuccess({ company, verificationUrl, verificationLogId: log.id }));
        } catch (error) {
            try {
                await deleteCompany({
                    teamId: c.var.team.id,
                    companyId: company.id,
                });
            } catch (rollbackError) {
                console.error(`Failed to rollback company ${company.id} after verification setup failed:`, rollbackError);
            }

            throw error;
        }
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not create company"), 500);
    }
}

export type CreateCompany = typeof _createCompany | typeof _createCompanyMinimal;

export default server;
