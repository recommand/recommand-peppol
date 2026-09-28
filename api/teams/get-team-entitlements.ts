import { requireTeamAccess } from "@core/lib/auth-middleware";
import { getExtendedTeam } from "@peppol/data/teams";
import { checkAllPeppolEntitlements } from "@peppol/lib/entitlements";
import { Server } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

const server = new Server();

const _getTeamEntitlements = server.get(
  "/:teamId/entitlements",
  requireTeamAccess(),
  describeRoute({ hide: true }),
  zodValidator("param", z.object({ teamId: z.string() })),
  async (c) => {
    const team = await getExtendedTeam(c.var.team.id);
    if (!team) {
      return c.json(actionFailure("Team not found"), 404);
    }
    return c.json(actionSuccess({ entitlements: await checkAllPeppolEntitlements(team) }));
  }
);

export type GetTeamEntitlements = typeof _getTeamEntitlements;

export default server;
