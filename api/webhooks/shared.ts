import { z } from "zod";
import "zod-openapi/extend";

export const webhookResponse = z.object({
    id: z.string(),
    teamId: z.string(),
    companyId: z.string().nullable(),
    url: z.string().url(),
    secret: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().nullable(),
});
