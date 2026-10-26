import { type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { getExtendedTeam } from "@peppol/data/teams";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import "zod-openapi/extend";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { requireTeamAccess } from "@core/lib/auth-middleware";

const server = new Server();

const getTeamExtensionParamSchema = z.object({
    teamId: z.string(),
});

type GetTeamExtensionContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof getTeamExtensionParamSchema> }, out: { param: z.infer<typeof getTeamExtensionParamSchema> } }>;

const _getTeamExtension = server.get(
    "/:teamId/team-extension",
    requireTeamAccess(),
    describeRoute({ hide: true }),
    zodValidator("param", getTeamExtensionParamSchema),
    async (c: GetTeamExtensionContext) => {
        try {
            const extendedTeam = await getExtendedTeam(c.var.team.id);
            if (!extendedTeam) {
                return c.json(actionFailure("Team not found"), 404);
            }
            return c.json(actionSuccess({
                verificationRequirements: extendedTeam.verificationRequirements ?? "lax",
                useTestNetwork: extendedTeam.useTestNetwork ?? false,
            }));
        } catch (error) {
            return c.json(actionFailure("Could not fetch team extension"), 500);
        }
    }
);

export type GetTeamExtension = typeof _getTeamExtension;

export default server;

