import { getCompanyById } from "@peppol/data/companies";
import { getCompanyVerificationLog, submitIdentityForm } from "@peppol/data/company-verification";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { UserFacingError } from "@peppol/utils/util";
import { describeRoute } from "hono-openapi";

const server = new Server();

const submitIdentityFormParamSchema = z.object({
    companyVerificationLogId: z.string(),
});

const submitIdentityFormJsonBodySchema = z.object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    mandateAccepted: z.boolean().default(false),
});

type SubmitIdentityFormContext = Context<Record<string, never>, string, { in: { param: z.input<typeof submitIdentityFormParamSchema>, json: z.input<typeof submitIdentityFormJsonBodySchema> }, out: { param: z.infer<typeof submitIdentityFormParamSchema>, json: z.infer<typeof submitIdentityFormJsonBodySchema> } }>;

const _submitIdentityForm = server.post(
    "/companies/verification/:companyVerificationLogId/submit-identity-form",
    describeRoute({ hide: true }),
    zodValidator("param", submitIdentityFormParamSchema),
    zodValidator("json", submitIdentityFormJsonBodySchema),
    _submitIdentityFormImplementation,
);

async function _submitIdentityFormImplementation(c: SubmitIdentityFormContext) {
    try {
        const { companyVerificationLogId } = c.req.valid("param");
        const { firstName, lastName, mandateAccepted } = c.req.valid("json");

        const verificationLog = await getCompanyVerificationLog(companyVerificationLogId);
        if (!verificationLog) {
            return c.json(actionFailure("Company verification log not found"), 404);
        }

        const company = await getCompanyById(verificationLog.companyId);
        if (!company) {
            return c.json(actionFailure("Company not found"), 404);
        }

        const verificationUrl = await submitIdentityForm(companyVerificationLogId, verificationLog, company, firstName, lastName, mandateAccepted);
        return c.json(actionSuccess({ verificationUrl }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not submit identity form"), 500);
    }
}

export type SubmitIdentityForm = typeof _submitIdentityForm;

export default server;
