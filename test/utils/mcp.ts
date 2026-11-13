import { Hono } from "hono";

/**
 * Loads the MCP tools with the document `/openapi` serves, as the server does, since the tools take
 * their permissions from the operations they name in it. Import it once `@recommand/db` is mocked.
 */
export const loadMcpTools = async () => {
  const { default: peppol, registerOpenApiRoutes } = await import("@peppol/index");
  const api = new Hono();
  api.route("/api", peppol);
  registerOpenApiRoutes(api);
};
