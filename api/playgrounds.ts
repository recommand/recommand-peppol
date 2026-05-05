import { requireAuth, requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { getPlayground, createPlayground } from "@peppol/data/playground/playgrounds";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { zodValidator } from "@recommand/lib/zod-validator";
import { z } from "zod";
import "zod-openapi/extend";
import { describeErrorResponse, describeSuccessResponse } from "@core/lib/api-docs";
import type { CompanyAccessContext } from "@peppol/utils/auth-middleware";

const server = new Server();

const playgroundOpenapiSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Team ID" },
    name: { type: "string", description: "Team name" },
    teamDescription: { type: "string", description: "Team description" },
    isPlayground: { type: "boolean", description: "Whether the team is a playground" },
    useTestNetwork: { type: "boolean", description: "Whether to use the Peppol Test Network" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const getPlaygroundRouteDescription = describeRoute({
  operationId: "getPlayground",
  description: "Get the playground information for a team (if it is a playground).",
  summary: "Get Playground",
  tags: ["Playgrounds"],
  responses: {
    ...describeSuccessResponse("Successfully retrieved playground", {
      playground: playgroundOpenapiSchema,
    }),
    ...describeErrorResponse(404, "Playground not found for this team"),
    ...describeErrorResponse(500, "Failed to fetch playground"),
  },
});

type GetPlaygroundContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string>;

const _getPlaygroundMinimal = server.get(
  "/playgrounds/current",
  requireTeamAccess(),
  getPlaygroundRouteDescription,
 _getPlaygroundImplementation,
);

const _getPlayground = server.get(
  "/:teamId/playground",
  requireTeamAccess(),
  describeRoute({hide: true}),
  zodValidator("param", z.object({ teamId: z.string() })),
 _getPlaygroundImplementation,
);

async function _getPlaygroundImplementation(c: GetPlaygroundContext) {
  try {
    const playground = await getPlayground(c.var.team.id);
    if (!playground) {
      return c.json(actionFailure("Playground not found for this team"), 404);
    }
    return c.json(actionSuccess({ playground }));
  } catch (error) {
    return c.json(actionFailure("Could not fetch playground"), 500);
  }
}

const createPlaygroundRouteDescription = describeRoute({
  operationId: "createPlayground",
  description: "Create a new playground team and add the current user as a member.",
  summary: "Create Playground",
  tags: ["Playgrounds"],
  responses: {
    ...describeSuccessResponse("Successfully created playground", {
      playground: playgroundOpenapiSchema,
    }),
    ...describeErrorResponse(400, "Invalid request data"),
    ...describeErrorResponse(401, "Unauthorized"),
    ...describeErrorResponse(500, "Failed to create playground"),
  },
});

const createPlaygroundJsonBodySchema = z.object({
  name: z.string().min(1).openapi({ description: "Playground name" }),
  useTestNetwork: z.boolean().default(false).openapi({ description: "Whether to use the Peppol Test Network" }),
});

type CreatePlaygroundContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext, string, { in: { json: z.input<typeof createPlaygroundJsonBodySchema> }, out: { json: z.infer<typeof createPlaygroundJsonBodySchema> } }>;

const _createPlayground = server.post(
  "/playgrounds",
  requireAuth(),
  createPlaygroundRouteDescription,
  zodValidator("json", createPlaygroundJsonBodySchema),
  _createPlaygroundImplementation,
);

async function _createPlaygroundImplementation(c: CreatePlaygroundContext) {
  try {
    const user = c.get("user");
    if (!user?.id) {
      return c.json(actionFailure("Unauthorized"), 401);
    }
    const { name, useTestNetwork } = c.req.valid("json");
    const playground = await createPlayground(user.id, name, "Playground", useTestNetwork);
    return c.json(actionSuccess({ playground }));
  } catch (error) {
    console.error(error);
    return c.json(actionFailure("Could not create playground"), 500);
  }
}

export type Playgrounds = typeof _getPlayground | typeof _getPlaygroundMinimal | typeof _createPlayground;

export default server;


