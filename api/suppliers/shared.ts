import { z } from "zod";
import "zod-openapi/extend";

export const labelResponse = z.object({
  id: z.string(),
  externalId: z.string().nullable(),
  name: z.string(),
  colorHex: z.string(),
});

export const supplierResponse = z.object({
  id: z.string(),
  teamId: z.string(),
  externalId: z.string().nullable(),
  name: z.string(),
  vatNumber: z.string().nullable(),
  peppolAddresses: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  labels: z.array(labelResponse).optional(),
});

export const supplierIdParamSchema = z.object({
  supplierId: z.string().openapi({
    description: "The internal ID or external ID of the supplier",
  }),
});

