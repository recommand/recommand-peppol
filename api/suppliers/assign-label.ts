import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { assignLabelToSupplier } from "@peppol/data/supplier-labels";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { UserFacingError } from "@peppol/utils/util";
import { supplierIdParamSchema } from "./shared";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const assignLabelRouteDescription = describeRoute({
    operationId: "assignLabelToSupplier",
    description: "Assign a label to a supplier",
    summary: "Assign Label to Supplier",
    tags: ["Suppliers"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully assigned label to supplier", z.object({})),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(404, "Supplier or label not found"),
        ...describeErrorResponse(500, "Failed to assign label"),
    },
});

const assignLabelParamSchema = supplierIdParamSchema.extend({
    labelId: z.string().openapi({
        description: "The ID of the label to assign",
    }),
});

const assignLabelParamSchemaWithTeamId = assignLabelParamSchema.extend({
    teamId: z.string(),
});

type AssignLabelContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof assignLabelParamSchemaWithTeamId> }, out: { param: z.infer<typeof assignLabelParamSchemaWithTeamId> } }>;

const _assignLabelMinimal = server.post(
    "/suppliers/:supplierId/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    assignLabelRouteDescription,
    zodValidator("param", assignLabelParamSchema),
    _assignLabelImplementation,
);

const _assignLabel = server.post(
    "/:teamId/suppliers/:supplierId/labels/:labelId",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", assignLabelParamSchemaWithTeamId),
    _assignLabelImplementation,
);

async function _assignLabelImplementation(c: AssignLabelContext) {
    try {
        const { supplierId, labelId } = c.req.valid("param");
        await assignLabelToSupplier(c.var.team.id, supplierId, labelId);
        return c.json(actionSuccess({}));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 404);
        }
        return c.json(actionFailure("Could not assign label"), 500);
    }
}

export type AssignLabel = typeof _assignLabel | typeof _assignLabelMinimal;

export default server;

