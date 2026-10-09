import { z } from "zod";
import "zod-openapi/extend";

// **********************************************************
// * Integration Manifest Schema
// **********************************************************

export const integrationEventSchema = z.enum([
  "document.received",
  "document.label.assigned",
  "document.label.unassigned",
  "integration.setup",
  "integration.teardown",
  "integration.incoming-webhook",
  "integration.cron.short",
  "integration.cron.medium",
  "integration.cron.long",
  "integration.task.retry",
]);

export const integrationAuthTypeSchema = z.enum(["bearer"]);

export const manifestCapabilitySchema = z
  .object({
    event: integrationEventSchema,
    description: z.string().min(1),
    required: z.boolean(),
  })
  .strict()
  .openapi({ ref: "IntegrationCapability" });

export const manifestFieldSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_]+$/),
    title: z.string().min(1),
    description: z.string().min(1),
    type: z.enum(["string", "boolean", "number"]),
    required: z.boolean(),
  })
  .strict()
  .openapi({ ref: "IntegrationField" });

export const manifestSchema = z
  .object({
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    name: z.string().min(1),
    description: z.string(),
    imageUrl: z.string().url().nullable(),
    url: z.string().url().min(1),
    capabilities: z.array(manifestCapabilitySchema),
    authTypes: z.array(integrationAuthTypeSchema).min(1),
    fields: z.array(manifestFieldSchema),
  })
  .strict()
  .openapi({ ref: "IntegrationManifest" });

export type IntegrationManifest = z.infer<typeof manifestSchema>;
export type IntegrationEvent = z.infer<typeof integrationEventSchema>;
