import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionSuccess } from "@recommand/lib/utils";
import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import {
    describeErrorResponse,
    describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { requireIntegrationSupportedTeamAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { verifyRecipient, fetchServiceMetadata, fetchBusinessCard } from "@peppol/data/recipient";
import { getTeamExtension } from "@peppol/data/teams";
import {
    findPlaygroundRecipient,
    isReservedUnknownRecipient,
    isSimulatedPlayground,
} from "@peppol/data/playground/recipients";
import { getDocumentTypeName } from "@peppol/utils/document-type-lookup";

const server = new Server();

/** A document type a participant is registered to receive, with endpoint details when they were requested. */
const supportedDocumentTypeResponse = z
    .object({
        certificateExpiry: z.string().nullable().optional().openapi({ description: "Certificate expiry date (ISO 8601)." }),
        docTypeId: z.string().openapi({ description: "Full Peppol document type identifier." }),
        name: z.string().openapi({ description: "Human-readable document type name." }),
        serviceEndpoint: z.string().nullable().optional().openapi({ description: "The endpoint URL." }),
        serviceProvider: z.string().nullable().optional().openapi({ description: "Service description from the endpoint metadata." }),
        technicalContact: z.string().nullable().optional().openapi({ description: "Technical contact URL." }),
    })
    .openapi({ ref: "SupportedDocumentType" });

const verifyRecipientRouteDescription = describeRoute({
    operationId: "verifyRecipient",
    description: "Look a Peppol address up in the SMP and report what the participant behind it is registered to receive. Use it before sending to check that an address exists and to see its document types. A lookup that fails, including for an address that is not registered at all, is not an error: the response is `{ isValid: false }` with no further fields. In a playground that is not connected to the Peppol Test Network, an address that belongs to a company in the same playground reports that company's document types, without SMP or endpoint fields; any other address is looked up on the production network, as the send endpoint does.",
    summary: "Verify Recipient",
    tags: ["Recipients"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully verified recipient", z.object({
            isValid: z.boolean().openapi({ description: "Whether the recipient could be resolved in the Peppol network. A lookup failure also returns false." }),
            smpUrl: z.string().optional().openapi({ description: "The SMP URL of the recipient. Absent when the lookup failed." }),
            serviceMetadataReferences: z.array(z.string()).optional().openapi({ description: "The service metadata references of the recipient. Absent when the lookup failed." }),
            smpHostnames: z.array(z.string()).optional().openapi({ description: "The SMP hostnames of the recipient. Absent when the lookup failed." }),
            supportedDocuments: z.array(supportedDocumentTypeResponse).optional().openapi({ description: "Document types supported by this participant. Includes endpoint details when includeEndpointDetails is true. Absent when the lookup failed." }),
            companyName: z.string().nullable().optional().openapi({ description: "Company name from SMP business card." }),
            countryCode: z.string().nullable().optional().openapi({ description: "Country code from SMP business card." }),
        })),
        ...describeErrorResponse(401, "Unauthorized"),
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

        // Answered from the same place a send would be routed from, so the two agree.
        if (teamExtension && isSimulatedPlayground(teamExtension)) {
            if (isReservedUnknownRecipient(peppolAddress)) {
                return c.json(actionSuccess({ isValid: false }));
            }
            const playgroundRecipient = await findPlaygroundRecipient({ recipientAddress: peppolAddress, playgroundTeamId: c.var.team.id });
            if (playgroundRecipient) {
                const docTypeIds = [...new Set(playgroundRecipient.registrations.map((registration) => registration.docTypeId))];
                const result: Record<string, unknown> = {
                    isValid: true,
                    supportedDocuments: docTypeIds.map((docTypeId) => ({ name: getDocumentTypeName(docTypeId), docTypeId })),
                };
                if (includeBusinessCard) {
                    Object.assign(result, {
                        companyName: playgroundRecipient.company.name,
                        countryCode: playgroundRecipient.company.country,
                    });
                }
                return c.json(actionSuccess(result));
            }
        }

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