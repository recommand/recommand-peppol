import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";
import { getEnterpriseData } from "@peppol/data/cbe-public-search/client";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { cleanEnterpriseNumber } from "@peppol/utils/util";
import type { IntegrationSupportedAuthContext } from "@peppol/utils/auth-middleware";
import { requireIntegrationSupportedAuth, requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const vatLookupQuerySchema = z.object({
    country: z.string(),
    vatNumber: z.string(),
});

const vatLookupParamSchema = z.object({
    teamId: z.string(),
});

const vatLookupResponse = z.object({
    address: z.string().nullable().openapi({
        description: "The street and number, or `null` when the register has none.",
    }),
    city: z.string().nullable().openapi({
        description: "The city, or `null` when the register has none.",
    }),
    country: z.literal("BE").openapi({
        description: "Always `BE`: only Belgian companies can be looked up.",
    }),
    name: z.string().nullable().openapi({
        description: "The company's registered name, or `null` when the register has none.",
    }),
    postalCode: z.string().nullable().openapi({
        description: "The postal code, or `null` when the register has none.",
    }),
});

type VatLookupContext = Context<IntegrationSupportedAuthContext, string, { in: { query: z.input<typeof vatLookupQuerySchema> }, out: { query: z.infer<typeof vatLookupQuerySchema> } }>;

// IMPORTANT: Even though these endpoints are hidden routes, they are also used by some internal integrations, so make sure to keep them backwards compatible.

// The lookup reads the public Belgian enterprise register, so it answers the same for every team and doesn't need one
const _vatLookup = server.get(
    "/vat-lookup",
    requireIntegrationSupportedAuth(),
    describeRoute({
        description: "Look a Belgian company up by VAT or enterprise number in the public enterprise register, and return its name and address.",
        hide: true,
        operationId: "lookUpBelgianCompany",
        responses: {
            ...describeSuccessResponse("The company as the register knows it", vatLookupResponse),
            ...describeErrorResponse(400, "The country isn't Belgium, or the company couldn't be looked up"),
            ...describeErrorResponse(401, "Unauthorized"),
        },
        summary: "Look up a Belgian company",
        tags: ["Companies"],
    }),
    zodValidator("query", vatLookupQuerySchema),
    _vatLookupImplementation,
);

// Kept for integrations that still name their team in the path
const _vatLookupWithTeamId = server.get(
    "/:teamId/vat-lookup",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({
        deprecated: true,
        hide: true,
    }),
    zodValidator("param", vatLookupParamSchema),
    zodValidator("query", vatLookupQuerySchema),
    _vatLookupImplementation,
);

async function _vatLookupImplementation(c: VatLookupContext) {
    const { country, vatNumber } = c.req.valid("query");

    if (country !== "BE") {
        return c.json(actionFailure("Company lookup is only available for Belgian companies"), 400);
    }

    try {
        let enterpriseNumber = cleanEnterpriseNumber(vatNumber)!;
        if (enterpriseNumber.startsWith("BE")) {
            enterpriseNumber = enterpriseNumber.slice(2);
        }

        const enterpriseData = await getEnterpriseData(enterpriseNumber, country);

        const address = enterpriseData.address
            ? `${enterpriseData.address.street ?? ""} ${enterpriseData.address.number ?? ""}`.trim() || null
            : null;

        return c.json(actionSuccess({
            name: enterpriseData.companyType?.denomination?.description || null,
            address,
            postalCode: enterpriseData.address?.postalCode != null ? String(enterpriseData.address.postalCode) : null,
            city: enterpriseData.address?.city || null,
            country: "BE",
        }));
    } catch (error) {
        console.error(error);
        return c.json(actionFailure("Could not look up company data"), 400);
    }
}

export type VatLookup = typeof _vatLookup | typeof _vatLookupWithTeamId;

export default server;
