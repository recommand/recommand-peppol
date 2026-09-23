import { z } from "zod";
import "zod-openapi/extend";

export const webhookResponse = z.object({
    id: z.string().openapi({
        description: "The ID of the webhook. Use it with the get, update and delete webhook endpoints.",
        example: "wh_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    teamId: z.string().openapi({
        description: "The ID of the team whose events this webhook receives.",
        example: "team_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    companyId: z.string().nullable().openapi({
        description: "The company this webhook is limited to. Null means it receives the events of every company in the team.",
        example: null,
    }),
    url: z.string().url().openapi({
        description: "The HTTPS endpoint events are delivered to, as a JSON POST body.",
        example: "https://example.com/hooks/recommand",
    }),
    secret: z.string().nullable().openapi({
        description: "The signing secret, returned in full on every read. Null when signing is off. When it is set, each delivery carries an `X-Signature: sha256=<hex>` header, an HMAC-SHA256 of the raw request body; recompute it to confirm the request came from us.",
    }),
    createdAt: z.string().datetime().openapi({
        description: "When the webhook was created.",
    }),
    updatedAt: z.string().datetime().nullable().openapi({
        description: "When the webhook was last changed. Null when it has not changed since it was created.",
    }),
});
