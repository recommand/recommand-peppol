import { getCompanyById } from "@peppol/data/companies";
import { getCompanyVerificationLog } from "@peppol/data/company-verification";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { UserFacingError } from "@directory/utils/util";
import { getArratechVerificationProgress } from "@peppol/data/at/kyc-onboarding-state";

const server = new Server();

const getVerificationStatusParamSchema = z.object({
    companyVerificationLogId: z.string(),
});

type GetVerificationStatusContext = Context<Record<string, never>, string, { in: { param: z.input<typeof getVerificationStatusParamSchema> }, out: { param: z.infer<typeof getVerificationStatusParamSchema> } }>;

const _getVerificationStatus = server.get(
    "/companies/verification/:companyVerificationLogId/status",
    describeRoute({ hide: true }),
    zodValidator("param", getVerificationStatusParamSchema),
    _getVerificationStatusImplementation,
);

async function _getVerificationStatusImplementation(c: GetVerificationStatusContext) {
    try {
        const { companyVerificationLogId } = c.req.valid("param");

        const verificationLog = await getCompanyVerificationLog(companyVerificationLogId);
        if (!verificationLog) {
            return c.json(actionFailure("Company verification log not found"), 404);
        }

        const company = await getCompanyById(verificationLog.companyId);
        if (!company) {
            return c.json(actionFailure("Company not found"), 404);
        }

        return c.json(actionSuccess({
            status: verificationLog.status,
            errorMessage: verificationLog.arratechOnboarding ? null : verificationLog.errorMessage,
            companyName: company.name,
            companyId: company.id,
            ...getArratechVerificationProgress(verificationLog.arratechOnboarding, company.isSmpRecipient, verificationLog.status),
        }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not fetch verification status"), 500);
    }
}

export type GetVerificationStatus = typeof _getVerificationStatus;

export default server;
