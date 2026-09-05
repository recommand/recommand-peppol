import { getCompanyById } from "@peppol/data/companies";
import { getCompanyVerificationLog } from "@peppol/data/company-verification";
import { buildMandateInput, requiresArratechKycReview } from "@peppol/data/at/kyc";
import { renderMandatePdf } from "@peppol/data/at/mandate";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { UserFacingError } from "@directory/utils/util";
import { verificationCountrySpecificSchema, validateVerificationCountrySpecific, getVerificationCountryRequirements } from '@peppol/types/verification-country-specific';

const server = new Server();

const getMandateDraftParamSchema = z.object({
    companyVerificationLogId: z.string(),
});

const getMandateDraftJsonBodySchema = z.object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    countrySpecific: verificationCountrySpecificSchema.nullish(),
});

type GetMandateDraftContext = Context<Record<string, never>, string, { in: { param: z.input<typeof getMandateDraftParamSchema>, json: z.input<typeof getMandateDraftJsonBodySchema> }, out: { param: z.infer<typeof getMandateDraftParamSchema>, json: z.infer<typeof getMandateDraftJsonBodySchema> } }>;

const _getMandateDraft = server.post(
    "/companies/verification/:companyVerificationLogId/mandate-draft",
    describeRoute({ hide: true }),
    zodValidator("param", getMandateDraftParamSchema),
    zodValidator("json", getMandateDraftJsonBodySchema),
    _getMandateDraftImplementation,
);

async function _getMandateDraftImplementation(c: GetMandateDraftContext) {
    try {
        const { companyVerificationLogId } = c.req.valid("param");
        const { firstName, lastName, countrySpecific } = c.req.valid("json");

        const verificationLog = await getCompanyVerificationLog(companyVerificationLogId);
        if (!verificationLog) {
            return c.json(actionFailure("Company verification log not found"), 404);
        }
        if (verificationLog.status !== "opened") {
            return c.json(actionFailure("This verification has already been submitted."), 400);
        }

        const company = await getCompanyById(verificationLog.companyId);
        if (!company) {
            return c.json(actionFailure("Company not found"), 404);
        }

        if (!(await requiresArratechKycReview(company))) {
            return c.json(actionFailure("This company does not sign a mandate."), 400);
        }

        const pdf = await renderMandatePdf(
            await buildMandateInput({
                company,
                countrySpecific: validateVerificationCountrySpecific(company, countrySpecific,
                    getVerificationCountryRequirements(company.country, true, company.isSmpRecipient)?.required),
                signatory: { firstName, lastName },
                signedAt: new Date(),
                // Nothing signs the draft yet; the identity verification does.
                proofReference: null,
                reference: verificationLog.id,
            }),
        );
        return c.body(new Uint8Array(pdf), 200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="mandate-${verificationLog.id}.pdf"`,
        });
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not render the mandate"), 500);
    }
}

export type GetMandateDraft = typeof _getMandateDraft;

export default server;
