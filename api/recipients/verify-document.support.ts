import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionSuccess } from "@recommand/lib/utils";
import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
    describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { verifyDocumentSupport } from "@peppol/data/recipient";
import { getTeamExtension } from "@peppol/data/teams";

const server = new Server();

const verifyDocumentSupportRouteDescription = describeRoute({
    operationId: "verifyDocumentSupport",
    description: "Check whether a Peppol address is registered to receive one specific document type, optionally under one specific process. Use it before sending a document type the recipient may not accept. A lookup that fails, including an address that is registered but not for this document type, is not an error: the response is `{ isValid: false }` with no further fields.",
    summary: "Verify Document Support",
    tags: ["Recipients"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully verified document support", z.object({
            isValid: z.boolean().openapi({ description: "Whether the recipient could be resolved in the Peppol network for this document type. A lookup failure also returns false." }),
            smpUrl: z.string().optional().openapi({ description: "The SMP URL of the recipient. Absent when the lookup failed." }),
            serviceProvider: z.string().nullable().optional().openapi({ description: "Service description from the endpoint metadata. Absent when the lookup failed." }),
            serviceEndpoint: z.string().nullable().optional().openapi({ description: "The endpoint URL the document would be delivered to. Absent when the lookup failed." }),
            technicalContact: z.string().nullable().optional().openapi({ description: "Technical contact URL published by the receiving access point. Absent when the lookup failed." }),
            certificateExpiry: z.string().nullable().optional().openapi({ description: "Expiry date of the receiving access point's certificate (ISO 8601). Absent when the lookup failed." }),
        })),
    },
});

const verifyDocumentSupportJsonBodySchema = z.object({
    peppolAddress: z.string().openapi({ description: "The Peppol address of the recipient to verify.", example: "0208:987654321" }),
    documentType: z.string().openapi({ description: "The document type to verify. You can use a full document type ID, or the simplified versions (e.g. \"invoice\", \"creditNote\", \"selfBillingInvoice\", \"selfBillingCreditNote\", ...).", example: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1" }),
    processId: z.string().optional().openapi({ description: "Optional process to verify the document type against, with or without its scheme prefix. When omitted, any process published for the document type is accepted.", example: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0" }),
});

type VerifyDocumentSupportContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { json: z.input<typeof verifyDocumentSupportJsonBodySchema> }, out: { json: z.infer<typeof verifyDocumentSupportJsonBodySchema> } }>;

const _verifyDocumentSupportMinimal = server.post(
    "/verify-document-support",
    requireIntegrationSupportedTeamAccess(),
    verifyDocumentSupportRouteDescription,
    zodValidator("json", verifyDocumentSupportJsonBodySchema),
    _verifyDocumentSupportImplementation,
);

const _verifyDocumentSupport = server.post(
    "/verifyDocumentSupport",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("json", verifyDocumentSupportJsonBodySchema),
    _verifyDocumentSupportImplementation,
);

async function _verifyDocumentSupportImplementation(c: VerifyDocumentSupportContext) {
    try {
        const { peppolAddress, documentType, processId } = c.req.valid("json");
        const teamExtension = await getTeamExtension(c.var.team.id);
        const { smpUrl, endpointDetails } = await verifyDocumentSupport({ recipientAddress: peppolAddress, documentType, processId, useTestNetwork: teamExtension?.useTestNetwork ?? false });
        return c.json(actionSuccess({ isValid: true, smpUrl, ...endpointDetails }));
    } catch (error) {
        console.error(error);
        return c.json(actionSuccess({ isValid: false }));
    }
}

export type VerifyDocumentSupport = typeof _verifyDocumentSupport | typeof _verifyDocumentSupportMinimal;

export default server;