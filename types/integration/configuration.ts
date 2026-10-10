import { z } from "zod";
import "zod-openapi/extend";
import { integrationEventSchema, integrationAuthTypeSchema } from "./manifest";

// **********************************************************
// * Integration Configuration Schema
// **********************************************************

export const configurationAuthSchema = z.object({
    type: integrationAuthTypeSchema,
    token: z.string().min(1),
  }).strict().openapi({ ref: "IntegrationAuth" });
  
  export const configurationFieldSchema = z.discriminatedUnion("type", [
    z.object({
      id: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/),
      type: z.literal("string"),
      value: z.string().min(1),
    }).strict().openapi({ ref: "StringConfigurationField" }),
    z.object({
      id: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/),
      type: z.literal("boolean"),
      value: z.boolean(),
    }).strict().openapi({ ref: "BooleanConfigurationField" }),
    z.object({
      id: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/),
      type: z.literal("number"),
      value: z.number(),
    }).strict().openapi({ ref: "NumberConfigurationField" }),
  ]).openapi({ ref: "IntegrationConfigurationField" });
  
  export const configurationCapabilitySchema = z.object({
    event: integrationEventSchema,
    enabled: z.boolean(),
  }).strict().openapi({ ref: "ConfiguredCapability" });
  
  export const configurationSchema = z.object({
    auth: configurationAuthSchema,
    fields: z.array(configurationFieldSchema),
    capabilities: z.array(configurationCapabilitySchema),
  }).strict().openapi({ ref: "IntegrationConfiguration" });
  
  export type IntegrationConfiguration = z.infer<typeof configurationSchema>;
  export type IntegrationConfigurationField = z.infer<typeof configurationFieldSchema>;