import { getCompanyById } from "@peppol/data/companies";
import { getCompanyVerificationLog } from "@peppol/data/company-verification";
import { listRepresentatives } from "@peppol/data/representative-checks";
import { requiresArratechKycReview } from "@peppol/data/at/kyc";
import { getMandateDocument } from "@peppol/data/at/mandate";
import { isPlayground } from "@peppol/data/teams";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { UserFacingError } from "@peppol/utils/util";
import { getVerificationCountryRequirements } from '@peppol/types/verification-country-specific';

const server = new Server();

const getVerificationContextParamSchema = z.object({
    companyVerificationLogId: z.string(),
});

type GetVerificationContextContext = Context<Record<string, never>, string, { in: { param: z.input<typeof getVerificationContextParamSchema> }, out: { param: z.infer<typeof getVerificationContextParamSchema> } }>;

const _getVerificationContext = server.get(
    "/companies/verification/:companyVerificationLogId/context",
    describeRoute({ hide: true, security: [] }),
    zodValidator("param", getVerificationContextParamSchema),
    _getVerificationContextImplementation,
);

async function _getVerificationContextImplementation(c: GetVerificationContextContext) {
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

        const teamIsPlayground = await isPlayground(company.teamId);
        const isMandateRequired = await requiresArratechKycReview(company);

        // Where the company's register lists who may act for it, the representative
        // picks their name from that list; playground teams type any name.
        const listed = teamIsPlayground ? null : await listRepresentatives(company);
        if (listed && !company.enterpriseNumber) {
            return c.json(actionFailure("Company does not have an enterprise number. Please complete the company details first."), 400);
        }
        const isRepresentativeSelectionRequired = listed !== null;
        const representatives = listed?.representatives ?? [];

        return c.json(actionSuccess({
            verificationLog: {
                id: verificationLog.id,
                status: verificationLog.status,
                // Withdrawn by support in favour of an earlier session; see the status route.
                withdrawn: verificationLog.withdrawal !== null,
                companyName: verificationLog.companyName,
                errorMessage: verificationLog.withdrawal !== null ? null : verificationLog.errorMessage,
                // Whose identity check a started session waits for, so whoever opens
                // the link can tell whether it is theirs to complete.
                representativeName: verificationLog.status === "idVerificationRequested" ? getRepresentativeName(verificationLog) : null,
            },
            company: {
                id: company.id,
                name: company.name,
                country: company.country,
                enterpriseNumber: company.enterpriseNumber,
            },
            isRepresentativeSelectionRequired,
            representatives,
            // What the form asks when the register lists nobody.
            nameWithoutRepresentatives: listed?.nameWithoutList ?? "typed",
            isPlayground: teamIsPlayground,
            isMandateRequired,
            countryRequirements: getVerificationCountryRequirements(company.country, isMandateRequired, company.isSmpRecipient),
            // The signatory reads the mandate under the name the document
            // itself carries, which differs per jurisdiction.
            mandateTitle: isMandateRequired
                ? getMandateDocument(company.country).title
                : null,
        }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not fetch verification context"), 500);
    }
}

/** The name the session was started for, or null while it is unknown. */
function getRepresentativeName({ firstName, lastName }: { firstName: string | null; lastName: string | null }): string | null {
    const name = [firstName, lastName].filter((part) => part && part.trim() && part !== "UNKNOWN").join(" ").trim();
    return name || null;
}

export type GetVerificationContext = typeof _getVerificationContext;

export default server;
