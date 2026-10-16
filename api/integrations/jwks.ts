import { Server } from "@recommand/lib/api";
import { z } from "zod";
import "zod-openapi/extend";
import { zodResolver } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { describeErrorResponse } from "@core/lib/api-docs";

const server = new Server();

const jsonWebKey = z
    .object({
        alg: z.literal("RS256").openapi({
            description: "The algorithm the key verifies signatures with.",
        }),
        e: z.string().openapi({
            description: "The RSA public exponent, base64url-encoded.",
            example: "AQAB",
        }),
        kty: z.literal("RSA").openapi({
            description: "The key type.",
        }),
        n: z.string().openapi({
            description: "The RSA modulus, base64url-encoded.",
        }),
        use: z.literal("sig").openapi({
            description: "What the key is for: verifying signatures.",
        }),
    })
    .openapi({
        ref: "JsonWebKey",
        description: "A public key, as a JSON Web Key (RFC 7517), that verifies the tokens Recommand signs for integrations.",
    });

// The key set is served as defined by RFC 7517, so it has no `success` envelope
// and is described directly instead of with `describeSuccessResponseWithZod`.
const jsonWebKeySet = z.object({
    keys: z.array(jsonWebKey).openapi({
        description: "The keys any token signed for an integration can be verified with. Empty when none are configured.",
    }),
});

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
                    schema: zodResolver(jsonWebKeySet),
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
