import { getCompanyById } from "@peppol/data/companies";
import { getCompanyVerificationLog } from "@peppol/data/company-verification";
import { getEnterpriseData } from "@peppol/data/cbe-public-search/client";
import { requiresArratechKycReview } from "@peppol/data/at/kyc";
import { isPlayground } from "@peppol/data/teams";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { UserFacingError } from "@peppol/utils/util";

const server = new Server();

const getVerificationContextParamSchema = z.object({
    companyVerificationLogId: z.string(),
});

type GetVerificationContextContext = Context<Record<string, never>, string, { in: { param: z.input<typeof getVerificationContextParamSchema> }, out: { param: z.infer<typeof getVerificationContextParamSchema> } }>;

const _getVerificationContext = server.get(
    "/companies/verification/:companyVerificationLogId/context",
    describeRoute({ hide: true }),
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
        const isRepresentativeSelectionRequired = !teamIsPlayground && company.country === "BE";
        const isMandateRequired = await requiresArratechKycReview(company);

        let representatives: { firstName: string; lastName: string; function: string }[] = [];
        if (isRepresentativeSelectionRequired) {
            if (!company.enterpriseNumber) {
                return c.json(actionFailure("Company does not have an enterprise number. Please complete the company details first."), 400);
            }
            try {
                const lookupNumber = company.country === "BE" && company.enterpriseNumber.toUpperCase().startsWith("BE") ? company.enterpriseNumber.slice(2) : company.enterpriseNumber;
                const enterpriseData = await getEnterpriseData(lookupNumber, company.country);
                representatives = enterpriseData.representatives
                    .filter((rep) => rep.firstName && rep.lastName)
                    .map((rep) => ({
                        firstName: rep.firstName!,
                        lastName: rep.lastName!,
                        function: rep.function ?? "",
                    }));
            } catch (error) {
                console.error("Failed to fetch enterprise data:", error);
            }
        }

        return c.json(actionSuccess({
            verificationLog: {
                id: verificationLog.id,
                status: verificationLog.status,
                companyName: verificationLog.companyName,
                errorMessage: verificationLog.errorMessage,
            },
            company: {
                id: company.id,
                name: company.name,
                enterpriseNumber: company.enterpriseNumber,
            },
            isRepresentativeSelectionRequired,
            representatives,
            isPlayground: teamIsPlayground,
            isMandateRequired,
        }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not fetch verification context"), 500);
    }
}

export type GetVerificationContext = typeof _getVerificationContext;

export default server;
