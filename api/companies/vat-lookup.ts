import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { getEnterpriseData } from "@peppol/data/cbe-public-search/client";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { cleanEnterpriseNumber } from "@peppol/utils/util";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const vatLookupQuerySchema = z.object({
    country: z.string(),
    vatNumber: z.string(),
});

const vatLookupParamSchema = z.object({
    teamId: z.string(),
});

type VatLookupContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof vatLookupParamSchema>, query: z.input<typeof vatLookupQuerySchema> }, out: { param: z.infer<typeof vatLookupParamSchema>, query: z.infer<typeof vatLookupQuerySchema> } }>;

const _vatLookup = server.get(
    "/:teamId/vat-lookup",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({ hide: true }),
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

export type VatLookup = typeof _vatLookup;

export default server;
