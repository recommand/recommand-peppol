import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { audit } from "@core/lib/audit";
import { getCompany } from "@peppol/data/companies";
import { verifyCompanyByContract } from "@peppol/data/company-contract-verification";
import { getTeamExtension } from "@peppol/data/teams";
import { isPdfDocument, MAX_CONTRACT_PDF_SIZE } from "@peppol/utils/pdf-validation";
import { UserFacingError } from "@peppol/utils/util";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";

const server = new Server();

const verifyCompanyByContractRouteDescription = describeRoute({
    operationId: "verifyCompanyByContract",
    description: "> **Not generally available.** This endpoint is only available to teams with an enterprise contract with Recommand that includes contract-based verification. For all other teams it returns a `400` error. To discuss access, contact support@recommand.eu. All other integrations should use the Verify Company endpoint.\n\nVerifies a company directly from a signed contract PDF, instead of the interactive identity verification. Upload the contract as `multipart/form-data` in the `contract` field.",
    summary: "Verify Company By Contract",
    tags: ["Companies"],
    requestBody: {
        required: true,
        content: {
            "multipart/form-data": {
                schema: {
                    type: "object",
                    properties: {
                        contract: {
                            type: "string",
                            format: "binary",
                            description: "The signed contract PDF used as evidence for automatic company verification.",
                        },
                    },
                    required: ["contract"],
                },
                encoding: {
                    contract: { contentType: "application/pdf" },
                },
            },
        },
    },
    responses: {
        ...describeSuccessResponseWithZod("Successfully verified company by contract"),
        ...describeErrorResponse(400, "Invalid request data, invalid contract, or the team is not enabled for contract verification"),
        ...describeErrorResponse(404, "Company not found"),
        ...describeErrorResponse(500, "Failed to verify company by contract"),
    },
});

const verifyCompanyByContractParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to verify",
    }),
});

const verifyCompanyByContractParamSchemaWithTeamId = verifyCompanyByContractParamSchema.extend({
    teamId: z.string(),
});

type VerifyCompanyByContractContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof verifyCompanyByContractParamSchemaWithTeamId> }, out: { param: z.infer<typeof verifyCompanyByContractParamSchemaWithTeamId> } }>;

const _verifyCompanyByContractMinimal = server.post(
    "/companies/:companyId/verify-by-contract",
    requireTeamAccess(),
    verifyCompanyByContractRouteDescription,
    zodValidator("param", verifyCompanyByContractParamSchema),
    _verifyCompanyByContractImplementation,
);

const _verifyCompanyByContract = server.post(
    "/:teamId/companies/:companyId/verify-by-contract",
    requireTeamAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", verifyCompanyByContractParamSchemaWithTeamId),
    _verifyCompanyByContractImplementation,
);

async function readContract(c: VerifyCompanyByContractContext): Promise<{ contract: Uint8Array } | { error: string }> {
    if (!c.req.header("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
        return { error: "The request must be sent as multipart/form-data." };
    }

    let body: Record<string, string | File | (string | File)[]>;
    try {
        body = await c.req.parseBody();
    } catch {
        return { error: "The multipart form could not be parsed." };
    }

    const file = body["contract"];
    if (!(file instanceof File)) {
        return { error: "A valid PDF contract is required." };
    }
    if (file.size > MAX_CONTRACT_PDF_SIZE) {
        return { error: `The contract must not be larger than ${MAX_CONTRACT_PDF_SIZE / (1024 * 1024)} MB.` };
    }

    const contract = new Uint8Array(await file.arrayBuffer());
    if (!isPdfDocument(contract)) {
        return { error: "A valid PDF contract is required." };
    }

    return { contract };
}

async function _verifyCompanyByContractImplementation(c: VerifyCompanyByContractContext) {
    const { companyId } = c.req.valid("param");
    const team = c.var.team;

    try {
        // Enabled per team by Recommand, so the credentials' team decides and the
        // request itself cannot opt in.
        const teamExtension = await getTeamExtension(team.id);
        if (!teamExtension?.canVerifyCompaniesByContract) {
            await audit(c, {
                action: "authorize",
                subsystem: "peppol.company_verification",
                outcome: "denied",
                objectType: "peppol.company",
                objectId: companyId,
                teamId: team.id,
                reasonCode: "contract_verification_not_enabled",
            });
            return c.json(actionFailure({ authorization: ["Automatic contract verification is not enabled for this team. It requires an enterprise contract with Recommand; contact support@recommand.eu."] }), 400);
        }

        const company = await getCompany(team.id, companyId);
        if (!company) {
            return c.json(actionFailure({ companyId: ["Company not found."] }), 404);
        }

        const upload = await readContract(c);
        if ("error" in upload) {
            return c.json(actionFailure({ contract: [upload.error] }), 400);
        }

        const result = await verifyCompanyByContract({ company, contract: upload.contract });

        if (result.status === "alreadyVerified") {
            await audit(c, {
                action: "verify",
                subsystem: "peppol.company_verification",
                objectType: "peppol.company",
                objectId: company.id,
                teamId: company.teamId,
                reasonCode: "already_verified",
                metadata: { verificationMethod: "contract" },
            });
            return c.json(actionSuccess());
        }

        await audit(c, {
            action: "verify",
            subsystem: "peppol.company_verification",
            outcome: result.status === "verified" ? "allowed" : "failed",
            objectType: "peppol.company",
            objectId: company.id,
            teamId: company.teamId,
            before: { isVerified: false },
            after: { isVerified: result.status === "verified" },
            metadata: {
                verificationMethod: "contract",
                verificationLogId: result.verificationLogId,
                contractSha256: result.contractSha256,
                contractStorageKey: result.contractStorageKey,
                errorMessage: result.errorMessage,
            },
        });

        if (result.status === "error") {
            return c.json(actionFailure({ server: [result.errorMessage ?? "Failed to verify company by contract."] }), 500);
        }

        return c.json(actionSuccess());
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure({ server: ["Failed to verify company by contract."] }), 500);
    }
}

export type VerifyCompanyByContract = typeof _verifyCompanyByContract | typeof _verifyCompanyByContractMinimal;

export default server;
