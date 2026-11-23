import { z } from "zod";
import "zod-openapi/extend";

export const customerResponse = z.object({
  id: z.string().openapi({
    description: "The ID of the customer. Use it, or the external ID, wherever an endpoint takes a customerId.",
    examples: ["sd_cust_01JQZ8X0M4T7RB6K9V2NDHW3PA"],
  }),
  teamId: z.string().openapi({
    description: "The ID of the team the customer belongs to. Customers are team-wide, not per company.",
    examples: ["team_01JQZ8X0M4T7RB6K9V2NDHW3PA"],
  }),
  externalId: z.string().nullable().openapi({
    description: "Your own identifier for the customer, if you set one. It is unique within the team, so you can address a customer by the ID your system already uses.",
    examples: ["erp-customer-1042"],
  }),
  name: z.string().openapi({
    description: "The customer's name.",
    examples: ["Example Customer BV"],
  }),
  vatNumber: z.string().nullable().openapi({
    description: "The customer's VAT number, if recorded.",
    examples: ["BE0428643097"],
  }),
  enterpriseNumber: z.string().nullable().openapi({
    description: "The customer's registration number in its national business register, if recorded.",
    examples: ["0428643097"],
  }),
  peppolAddresses: z.array(z.string()).openapi({
    description: "The Peppol addresses recorded for the customer, each as `scheme:identifier`. Empty when none were recorded.",
    examples: [["0208:0428643097"]],
  }),
  address: z.string().openapi({
    description: "Street name and number of the customer's address.",
    examples: ["Kerkstraat 1"],
  }),
  city: z.string().openapi({
    description: "City of the customer's address.",
    examples: ["Brussel"],
  }),
  postalCode: z.string().openapi({
    description: "Postal code of the customer's address.",
    examples: ["1000"],
  }),
  country: z.string().openapi({
    description: "The country of the customer's address, in ISO 3166-1 alpha-2 format.",
    examples: ["BE"],
  }),
  email: z.string().nullable().openapi({
    description: "Contact email address recorded for the customer.",
    examples: ["billing@example.com"],
  }),
  phone: z.string().nullable().openapi({
    description: "Contact phone number recorded for the customer.",
    examples: ["+32 2 123 45 67"],
  }),
  createdAt: z.string().datetime().openapi({
    description: "When the customer was created.",
  }),
  updatedAt: z.string().datetime().openapi({
    description: "When the customer was last changed.",
  }),
}).openapi({ ref: "Customer" });

export const customerIdParamSchema = z.object({
  customerId: z.string().openapi({
    description: "The internal ID or external ID of the customer",
  }),
});
