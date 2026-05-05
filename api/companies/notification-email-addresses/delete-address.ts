import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { requireCompanyAccess, type CompanyAccessContext } from "@peppol/utils/auth-middleware";
import type { AuthenticatedUserContext, AuthenticatedTeamContext } from "@core/lib/auth-middleware";
import { deleteCompanyNotificationEmailAddress } from "@peppol/data/company-notification-emails";
import { UserFacingError } from "@peppol/utils/util";

const server = new Server();

const deleteAddressRouteDescription = describeRoute({
    operationId: "deleteCompanyNotificationEmailAddress",
    description: "Delete a company notification email address",
    summary: "Delete Company Notification Email Address",
    tags: ["Company Notification Email Addresses"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully deleted company notification email address", z.object({})),
        ...describeErrorResponse(404, "Company notification email address not found"),
        ...describeErrorResponse(500, "Failed to delete company notification email address"),
    },
});

const deleteAddressParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to delete a notification email address for",
    }),
    notificationEmailAddressId: z.string().openapi({
        description: "The ID of the notification email address to delete",
    }),
});

const deleteAddressParamSchemaWithTeamId = deleteAddressParamSchema.extend({ teamId: z.string() });

type DeleteAddressContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof deleteAddressParamSchemaWithTeamId> }, out: { param: z.infer<typeof deleteAddressParamSchemaWithTeamId> } }>;

const _deleteAddressMinimal = server.delete(
    "/companies/:companyId/notification-email-addresses/:notificationEmailAddressId",
    requireCompanyAccess(),
    deleteAddressRouteDescription,
    zodValidator("param", deleteAddressParamSchema),
    _deleteAddressImplementation,
);

const _deleteAddress = server.delete(
    "/:teamId/companies/:companyId/notification-email-addresses/:notificationEmailAddressId",
    requireCompanyAccess(),
    describeRoute({hide: true}),
    zodValidator("param", deleteAddressParamSchemaWithTeamId),
    _deleteAddressImplementation,
);

async function _deleteAddressImplementation(c: DeleteAddressContext) {
    try {
        await deleteCompanyNotificationEmailAddress(
            c.var.company.id,
            c.req.valid("param").notificationEmailAddressId
        );

        return c.json(actionSuccess());
    } catch (error) {
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error.message), 404);
        }
        console.error(error);
        return c.json(actionFailure("Could not delete company notification email address"), 500);
    }
}

export type DeleteAddress = typeof _deleteAddress | typeof _deleteAddressMinimal;

export default server;