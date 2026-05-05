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
import { verifyRecipient, fetchServiceMetadata, fetchBusinessCard } from "@peppol/data/recipient";
import { getTeamExtension } from "@peppol/data/teams";

const server = new Server();

const verifyRecipientRouteDescription = describeRoute({
    operationId: "verifyRecipient",
    description: "Verify if a recipient address is registered in the Peppol network",
    summary: "Verify Recipient",
    tags: ["Recipients"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully verified recipient", z.object({
            isValid: z.boolean().openapi({ description: "Whether the recipient is registered in the Peppol network." }),
            smpUrl: z.string().openapi({ description: "The SMP URL of the recipient." }),
            serviceMetadataReferences: z.array(z.string()).openapi({ description: "The service metadata references of the recipient." }),
            smpHostnames: z.array(z.string()).openapi({ description: "The SMP hostnames of the recipient." }),
            supportedDocuments: z.array(z.object({
                name: z.string().openapi({ description: "Human-readable document type name." }),
                docTypeId: z.string().openapi({ description: "Full Peppol document type identifier." }),
                serviceProvider: z.string().nullable().optional().openapi({ description: "Service description from the endpoint metadata." }),
                serviceEndpoint: z.string().nullable().optional().openapi({ description: "The endpoint URL." }),
                technicalContact: z.string().nullable().optional().openapi({ description: "Technical contact URL." }),
                certificateExpiry: z.string().nullable().optional().openapi({ description: "Certificate expiry date (ISO 8601)." }),
            })).openapi({ description: "Document types supported by this participant. Includes endpoint details when includeEndpointDetails is true." }),
            companyName: z.string().nullable().optional().openapi({ description: "Company name from SMP business card." }),
            countryCode: z.string().nullable().optional().openapi({ description: "Country code from SMP business card." }),
        })),
    },
});

const verifyRecipientJsonBodySchema = z.object({
    peppolAddress: z.string().openapi({ description: "The Peppol address of the recipient to verify." }),
    includeEndpointDetails: z.boolean().optional().openapi({ description: "If true, fetches endpoint details for all supported document types." }),
    includeBusinessCard: z.boolean().optional().openapi({ description: "If true, fetches the business card from the SMP for company name and country." }),
});

type VerifyRecipientContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { json: z.input<typeof verifyRecipientJsonBodySchema> }, out: { json: z.infer<typeof verifyRecipientJsonBodySchema> } }>;

const _verifyRecipient = server.post(
    "/verify",
    requireIntegrationSupportedTeamAccess(),
    verifyRecipientRouteDescription,
    zodValidator("json", verifyRecipientJsonBodySchema),
    _verifyRecipientImplementation,
);

async function _verifyRecipientImplementation(c: VerifyRecipientContext) {
    try {
        const { peppolAddress, includeEndpointDetails, includeBusinessCard } = c.req.valid("json");
        const teamExtension = await getTeamExtension(c.var.team.id);
        const useTestNetwork = teamExtension?.useTestNetwork ?? false;

        const data = await verifyRecipient({ recipientAddress: peppolAddress, useTestNetwork });

        let supportedDocuments = data.supportedDocuments;

        if (includeEndpointDetails) {
            supportedDocuments = await Promise.all(
                data.supportedDocuments.map(async (doc) => {
                    const ref = data.serviceMetadataReferences.find(r =>
                        r.includes(encodeURIComponent(doc.docTypeId)) || r.includes(doc.docTypeId)
                    );
                    if (!ref) return doc;

                    const details = await fetchServiceMetadata(ref);
                    return { ...doc, ...details };
                })
            );
        }

        const result: Record<string, unknown> = {
            isValid: true,
            smpUrl: data.smpUrl,
            serviceMetadataReferences: data.serviceMetadataReferences,
            smpHostnames: data.smpHostnames,
            supportedDocuments,
        };

        if (includeBusinessCard) {
            const businessCard = await fetchBusinessCard({ smpUrl: data.smpUrl, participantId: peppolAddress });
            if (businessCard) {
                Object.assign(result, businessCard);
            }
        }

        return c.json(actionSuccess(result));
    } catch (error) {
        return c.json(actionSuccess({ isValid: false }));
    }
}

export type VerifyRecipient = typeof _verifyRecipient;

export default server;