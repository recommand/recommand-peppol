import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { createCompanyVerificationLog } from "@peppol/data/company-verification";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import type { CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { UserFacingError } from "@peppol/utils/util";

const server = new Server();

const verifyCompanyRouteDescription = describeRoute({
    operationId: "verifyCompany",
    description: "To send or receive documents on behalf of a company, you must first verify your identity to confirm you are authorized to act for that company. This endpoint initiates a verification session and returns a URL. The URL leads to a secure form where an official company representative can provide proof of identity.",
    summary: "Verify Company",
    tags: ["Companies"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully created verification session", z.object({ verificationUrl: z.string() })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(404, "Company not found"),
        ...describeErrorResponse(500, "Failed to create verification session"),
    },
});

const verifyCompanyParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to verify",
    }),
});

const verifyCompanyParamSchemaWithTeamId = verifyCompanyParamSchema.extend({
    teamId: z.string(),
});

type VerifyCompanyContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof verifyCompanyParamSchemaWithTeamId> }, out: { param: z.infer<typeof verifyCompanyParamSchemaWithTeamId> } }>;

const _verifyCompanyMinimal = server.post(
    "/companies/:companyId/verify",
    requireTeamAccess(),
    verifyCompanyRouteDescription,
    zodValidator("param", verifyCompanyParamSchema),
    _verifyCompanyImplementation,
);

const _verifyCompany = server.post(
    "/:teamId/companies/:companyId/verify",
    requireTeamAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", verifyCompanyParamSchemaWithTeamId),
    _verifyCompanyImplementation,
);

async function _verifyCompanyImplementation(c: VerifyCompanyContext) {
    try {
        const companyId = c.req.valid("param").companyId;

        const { log, verificationUrl } = await createCompanyVerificationLog({
            teamId: c.var.team.id,
            companyId,
        });

        return c.json(actionSuccess({ verificationUrl, verificationLogId: log.id }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not create verification session"), 500);
    }
}

export type VerifyCompany = typeof _verifyCompany | typeof _verifyCompanyMinimal;

export default server;

