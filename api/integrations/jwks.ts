import { Server } from "@recommand/lib/api";
import "zod-openapi/extend";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse } from "@core/lib/api-docs";

const server = new Server();

const jwksRouteDescription = describeRoute({
    operationId: "getJwks",
    description: "Get the JSON Web Key Set (JWKS) for integration public keys",
    summary: "Get JWKS",
    tags: ["Integrations"],
    responses: {
        200: {
            description: "Successfully retrieved JWKS",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            keys: {
                                type: "array",
                                items: {
                                    type: "object",
                                },
                            },
                        },
                    },
                },
            },
        },
        ...describeErrorResponse(500, "Failed to retrieve JWKS"),
    },
});

const _jwks = server.get(
    "/integrations/jwks",
    jwksRouteDescription,
    async (c) => {
        try {
            const jwksEnv = process.env.INTEGRATIONS_JWKS;
            if (!jwksEnv) {
                return c.json({ keys: [] }, 200);
            }

            const jwks = JSON.parse(jwksEnv);
            return c.json(jwks, 200);
        } catch (error) {
            console.error("Failed to parse JWKS from environment variable:", error);
            return c.json({ error: "Failed to retrieve JWKS" }, 500);
        }
    }
);

export type GetJwks = typeof _jwks;

export default server;

