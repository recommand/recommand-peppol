import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import {
    createLabel,
} from "@peppol/data/labels";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse, describeSuccessResponseWithZod } from "@core/lib/api-docs";
import { labelResponse } from "./shared";
import { UserFacingError } from "@peppol/utils/util";
import { requireIntegrationSupportedTeamAccess } from "@peppol/utils/auth-middleware";

const server = new Server();

const createLabelRouteDescription = describeRoute({
    operationId: "createLabel",
    description:
        "Creates a label for the team. Labels are the routing primitive: assign one to a supplier and every document matched to that supplier inherits it, or assign one to a document directly. They are team-wide, so a label created here is available to every company in the team. Set `externalId` to the identifier your own system uses, so you can address the label without storing ours.",
    summary: "Create Label",
    tags: ["Labels"],
    responses: {
        ...describeSuccessResponseWithZod("Successfully created label", z.object({ label: labelResponse })),
        ...describeErrorResponse(400, "Invalid request data"),
        ...describeErrorResponse(500, "Failed to create label"),
    },
});

const hexColorRegex = /^#[A-Fa-f0-9]{6}$/;

const createLabelJsonBodySchema = z.object({
    name: z.string().min(1, "Name is required").openapi({
        example: "ERP",
        description: "The label's name. Keep it short: it is what you match on in your own routing code.",
    }),
    colorHex: z.string().regex(hexColorRegex, "Color must be a valid hex color (e.g., #3B82F6)").openapi({
        example: "#3B82F6",
        description: "The colour the label is shown in, as a hex code such as `#3B82F6`.",
    }),
    externalId: z.string().optional().nullable().openapi({
        example: "erp-routing-inbox",
        description: "Your own identifier for the label. It must be unique within the team.",
    }),
});

type CreateLabelContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { json: z.input<typeof createLabelJsonBodySchema> }, out: { json: z.infer<typeof createLabelJsonBodySchema> } }>;

const _createLabelMinimal = server.post(
    "/labels",
    requireIntegrationSupportedTeamAccess(),
    createLabelRouteDescription,
    zodValidator("json", createLabelJsonBodySchema),
    _createLabelImplementation,
);

const _createLabel = server.post(
    "/:teamId/labels",
    requireIntegrationSupportedTeamAccess(),
    describeRoute({hide: true}),
    zodValidator("param", z.object({ teamId: z.string() })),
    zodValidator("json", createLabelJsonBodySchema),
    _createLabelImplementation,
);

async function _createLabelImplementation(c: CreateLabelContext) {
    try {
        const label = await createLabel({
            ...c.req.valid("json"),
            teamId: c.var.team.id,
        });
        return c.json(actionSuccess({ label }));
    } catch (error) {
        console.error(error);
        if (error instanceof UserFacingError) {
            return c.json(actionFailure(error), 400);
        }
        return c.json(actionFailure("Could not create label"), 500);
    }
}

export type CreateLabel = typeof _createLabel | typeof _createLabelMinimal;

export default server;

