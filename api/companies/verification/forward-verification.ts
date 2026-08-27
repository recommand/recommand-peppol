import { getCompanyVerificationLog } from "@peppol/data/company-verification";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { sendEmail } from "@core/lib/email";
import { VerificationForwardingEmail, subject } from "@peppol/emails/verification-forwarding-email";
import { withTranslation } from "@core/lib/translation-middleware";
import type { TranslationFunction } from "@core/lib/translations";
import React from "react";

const server = new Server();

const forwardVerificationParamSchema = z.object({
    companyVerificationLogId: z.string(),
});

const forwardVerificationJsonBodySchema = z.object({
    email: z.string().email(),
    requesterName: z.string().trim().min(1),
    requesterEmail: z.string().email(),
});

type ForwardVerificationContext = Context<{ Variables: { t: TranslationFunction; language: string } }, string, { in: { param: z.input<typeof forwardVerificationParamSchema>, json: z.input<typeof forwardVerificationJsonBodySchema> }, out: { param: z.infer<typeof forwardVerificationParamSchema>, json: z.infer<typeof forwardVerificationJsonBodySchema> } }>;

const _forwardVerification = server.post(
    "/companies/verification/:companyVerificationLogId/forward",
    describeRoute({ hide: true }),
    zodValidator("param", forwardVerificationParamSchema),
    zodValidator("json", forwardVerificationJsonBodySchema),
    // Public route: the forwarding colleague works at the same company as the
    // sender, so the sender's browser language is the best guess available.
    withTranslation(),
    _forwardVerificationImplementation,
);

async function _forwardVerificationImplementation(c: ForwardVerificationContext) {
    try {
        const { companyVerificationLogId } = c.req.valid("param");
        const { email, requesterName, requesterEmail } = c.req.valid("json");

        const verificationLog = await getCompanyVerificationLog(companyVerificationLogId);
        if (!verificationLog) {
            return c.json(actionFailure("Company verification log not found"), 404);
        }

        if (verificationLog.status === "verified" || verificationLog.status === "rejected" || verificationLog.status === "error") {
            return c.json(actionFailure("This verification has already been completed."), 400);
        }

        const baseUrl = process.env.BASE_URL;
        if (!baseUrl) {
            throw new Error("BASE_URL environment variable is not set");
        }

        const companyName = verificationLog.companyName ?? "your company";
        const verificationLink = `${baseUrl}/company-verification/${companyVerificationLogId}/verify`;

        const t = c.get("t");
        await sendEmail({
            to: email,
            cc: requesterEmail,
            subject: subject({ companyName, t }),
            email: React.createElement(VerificationForwardingEmail, { companyName, verificationLink, requesterName, requesterEmail, t }),
        });

        return c.json(actionSuccess({}));
    } catch (error) {
        console.error(error);
        return c.json(actionFailure("Could not forward verification"), 500);
    }
}

export type ForwardVerification = typeof _forwardVerification;

export default server;
