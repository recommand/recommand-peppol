import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { requireCompanyAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { companyNotificationEmailAddressResponse } from "./shared";
import type { AuthenticatedUserContext, AuthenticatedTeamContext } from "@core/lib/auth-middleware";
import { getCompanyNotificationEmailAddresses } from "@peppol/data/company-notification-emails";

const server = new Server();

const getAddressesRouteDescription = describeRoute({
    operationId: "getCompanyNotificationEmailAddresses",
    description: "Get a list of all notification email addresses for a specific company",
    summary: "List Company Notification Email Addresses",
    tags: ["Company Notification Email Addresses"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved company notification email addresses", z.object({ notificationEmailAddresses: z.array(companyNotificationEmailAddressResponse) })),
        ...describeErrorResponse(500, "Failed to fetch company notification email addresses"),
    },
});

const getAddressesParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to get notification email addresses for",
    }),
});

const getAddressesParamSchemaWithTeamId = getAddressesParamSchema.extend({ teamId: z.string() });

type GetAddressesContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getAddressesParamSchemaWithTeamId> }, out: { param: z.infer<typeof getAddressesParamSchemaWithTeamId> } }>;

const _getAddressesMinimal = server.get(
    "/companies/:companyId/notification-email-addresses",
    requireCompanyAccess(),
    getAddressesRouteDescription,
    zodValidator("param", getAddressesParamSchema),
    _getAddressesImplementation,
);

const _getAddresses = server.get(
    "/:teamId/companies/:companyId/notification-email-addresses",
    requireCompanyAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getAddressesParamSchemaWithTeamId),
    _getAddressesImplementation,
);

async function _getAddressesImplementation(c: GetAddressesContext) {
    try {
        const notificationEmailAddresses = await getCompanyNotificationEmailAddresses(c.var.company.id);
        return c.json(actionSuccess({ notificationEmailAddresses }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch company notification email addresses"), 500);
    }
}

export type GetAddresses = typeof _getAddresses | typeof _getAddressesMinimal;

export default server;