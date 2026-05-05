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
import { getCompanyNotificationEmailAddress } from "@peppol/data/company-notification-emails";

const server = new Server();

const getAddressRouteDescription = describeRoute({
    operationId: "getCompanyNotificationEmailAddress",
    description: "Get a specific company notification email address by ID",
    summary: "Get Company Notification Email Address",
    tags: ["Company Notification Email Addresses"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully retrieved company notification email address", z.object({ notificationEmailAddress: companyNotificationEmailAddressResponse })),
        ...describeErrorResponse(404, "Company notification email address not found"),
        ...describeErrorResponse(500, "Failed to fetch company notification email address"),
    },
});

const getAddressParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to get a notification email address for",
    }),
    notificationEmailAddressId: z.string().openapi({
        description: "The ID of the notification email address to retrieve",
    }),
});

const getAddressParamSchemaWithTeamId = getAddressParamSchema.extend({ teamId: z.string() });

type GetAddressContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof getAddressParamSchemaWithTeamId> }, out: { param: z.infer<typeof getAddressParamSchemaWithTeamId> } }>;

const _getAddressMinimal = server.get(
    "/companies/:companyId/notification-email-addresses/:notificationEmailAddressId",
    requireCompanyAccess(),
    getAddressRouteDescription,
    zodValidator("param", getAddressParamSchema),
    _getAddressImplementation,
);

const _getAddress = server.get(
    "/:teamId/companies/:companyId/notification-email-addresses/:notificationEmailAddressId",
    requireCompanyAccess(),
    describeRoute({hide: true}),
    zodValidator("param", getAddressParamSchemaWithTeamId),
    _getAddressImplementation,
);

async function _getAddressImplementation(c: GetAddressContext) {
    try {
        const notificationEmailAddress = await getCompanyNotificationEmailAddress(
            c.var.company.id,
            c.req.valid("param").notificationEmailAddressId
        );

        if (!notificationEmailAddress) {
            return c.json(actionFailure("Company notification email address not found"), 404);
        }

        return c.json(actionSuccess({ notificationEmailAddress }));
    } catch (error) {
        return c.json(actionFailure("Could not fetch company notification email address"), 500);
    }
}

export type GetAddress = typeof _getAddress | typeof _getAddressMinimal;

export default server;