import { z } from "zod";
import "zod-openapi/extend";

export const customerResponse = z.object({
  id: z.string(),
  teamId: z.string(),
  externalId: z.string().nullable(),
  name: z.string(),
  vatNumber: z.string().nullable(),
  enterpriseNumber: z.string().nullable(),
  peppolAddresses: z.array(z.string()),
  address: z.string(),
  city: z.string(),
  postalCode: z.string(),
  country: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const customerIdParamSchema = z.object({
  customerId: z.string().openapi({
    description: "The internal ID or external ID of the customer",
  }),
});
