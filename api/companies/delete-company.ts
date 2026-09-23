import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
    deleteCompany,
} from "@peppol/data/companies";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";
import type { CompanyAccessContext } from "@peppol/utils/auth-middleware";
import { audit } from "@core/lib/audit";

const server = new Server();

const deleteCompanyRouteDescription = describeRoute({
    operationId: "deleteCompany",
    description: "Permanently delete a company. If the company was registered in the SMP, its registration is removed first, so the Peppol network stops routing documents to it. Every document sent or received for the company is deleted with it, along with the stored XML, attachments and payloads; this cannot be undone. Set `isSmpRecipient` to false with the update company endpoint instead if you only want to stop receiving documents while keeping the history.",
    summary: "Delete Company",
    tags: ["Companies"],
    responses: {
        ...describeSuccessResponse("Successfully deleted company"),
        ...describeErrorResponse(500, "Failed to delete company"),
    },
});

const deleteCompanyParamSchema = z.object({
    companyId: z.string().openapi({
        description: "The ID of the company to delete",
    }),
});

const deleteCompanyParamSchemaWithTeamId = deleteCompanyParamSchema.extend({
    teamId: z.string(),
});

type DeleteCompanyContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { param: z.input<typeof deleteCompanyParamSchemaWithTeamId> }, out: { param: z.infer<typeof deleteCompanyParamSchemaWithTeamId> } }>;

const _deleteCompanyMinimal = server.delete(
    "/companies/:companyId",
    requireTeamAccess(),
    deleteCompanyRouteDescription,
    zodValidator("param", deleteCompanyParamSchema),
    _deleteCompanyImplementation,
);

const _deleteCompany = server.delete(
    "/:teamId/companies/:companyId",
    requireTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", deleteCompanyParamSchemaWithTeamId),
    _deleteCompanyImplementation,
);

async function _deleteCompanyImplementation(c: DeleteCompanyContext) {
    try {
        const companyId = c.req.valid("param").companyId;
        await deleteCompany({teamId: c.var.team.id, companyId});
        await audit(c, {
            action: "delete",
            subsystem: "peppol.companies",
            objectType: "peppol.company",
            objectId: companyId,
        });
        return c.json(actionSuccess());
      } catch (error) {
        console.error(error);
        return c.json(actionFailure("Could not delete company"), 500);
      }
}

export type DeleteCompany = typeof _deleteCompany | typeof _deleteCompanyMinimal;

export default server;
