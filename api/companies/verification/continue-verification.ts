import { continueVerificationFromSession } from "@peppol/data/company-verification";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { UserFacingError } from "@peppol/utils/util";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";

const server = new Server();

const continueVerificationParamSchema = z.object({
    companyVerificationLogId: z.string(),
});

type ContinueVerificationContext = Context<Record<string, never>, string, { in: { param: z.input<typeof continueVerificationParamSchema> }, out: { param: z.infer<typeof continueVerificationParamSchema> } }>;

// Public, like the rest of the verification flow: the link itself is what gives
// access to the company's verification. It leads on only to what asking to verify
// the company again would give, and approves nothing.
const _continueVerification = server.post(
    "/companies/verification/:companyVerificationLogId/continue",
    describeRoute({
        hide: true,
        security: [],
        operationId: "continueCompanyVerification",
        summary: "Continue Company Verification",
        description: "Leads on from a finished verification session to the company's verification as it stands: its open session is continued, or a new one is started. Refused when the session is not finished, was withdrawn, or the company is already verified.",
        tags: ["Companies"],
        responses: {
            ...describeSuccessResponse("The session to continue the verification in", z.object({
                verificationLogId: z.string().openapi({ description: "The ID of the verification session to continue in." }),
            }).openapi({ ref: "ContinuedCompanyVerification" })),
            ...describeErrorResponse(400, "The verification cannot be continued"),
            ...describeErrorResponse(500, "Failed to continue the verification"),
        },
    }),
    zodValidator("param", continueVerificationParamSchema),
    _continueVerificationImplementation,
);

async function _continueVerificationImplementation(c: ContinueVerificationContext) {
    try {
        const { companyVerificationLogId } = c.req.valid("param");
        const { log } = await continueVerificationFromSession(companyVerificationLogId);
        return c.json(actionSuccess({ verificationLogId: log.id }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not continue verification"), 500);
    }
}

export type ContinueVerification = typeof _continueVerification;

export default server;
