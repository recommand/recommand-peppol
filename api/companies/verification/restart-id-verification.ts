import { getCompanyById } from "@peppol/data/companies";
import { getCompanyVerificationLog, requestIdVerification } from "@peppol/data/company-verification";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { UserFacingError } from "@peppol/utils/util";
import { describeRoute } from "hono-openapi";

const server = new Server();

const restartIdVerificationParamSchema = z.object({
    companyVerificationLogId: z.string(),
});

type RestartIdVerificationContext = Context<Record<string, never>, string, { in: { param: z.input<typeof restartIdVerificationParamSchema> }, out: { param: z.infer<typeof restartIdVerificationParamSchema> } }>;

const _restartIdVerification = server.post(
    "/companies/verification/:companyVerificationLogId/restart-id-verification",
    describeRoute({ hide: true }),
    zodValidator("param", restartIdVerificationParamSchema),
    _restartIdVerificationImplementation,
);

async function _restartIdVerificationImplementation(c: RestartIdVerificationContext) {
    try {
        const { companyVerificationLogId } = c.req.valid("param");

        const verificationLog = await getCompanyVerificationLog(companyVerificationLogId);
        if (!verificationLog) {
            return c.json(actionFailure("Company verification log not found"), 404);
        }

        if (verificationLog.status !== "idVerificationRequested") {
            return c.json(actionFailure("Verification cannot be restarted from its current state"), 400);
        }

        const company = await getCompanyById(verificationLog.companyId);
        if (!company) {
            return c.json(actionFailure("Company not found"), 404);
        }

        const verificationUrl = await requestIdVerification(companyVerificationLogId, verificationLog, company);
        return c.json(actionSuccess({ verificationUrl }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not restart identity verification"), 500);
    }
}

export type RestartIdVerification = typeof _restartIdVerification;

export default server;
