import { Server } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { requireAuth } from "@core/lib/auth-middleware";
import { receivingCapabilities } from "@peppol/utils/type-repository/receiving-capabilities";

const server = new Server();

const _getReceivingCapabilities = server.get(
  "/receivingCapabilities",
  requireAuth(),
  describeRoute({ hide: true }),
  async (c) => {
    try {
      return c.json(actionSuccess({ receivingCapabilities }));
    } catch (error) {
      return c.json(actionFailure("Could not fetch receiving capabilities"), 500);
    }
  },
);

export type ReceivingCapabilities = typeof _getReceivingCapabilities;

export default server;
