import { z } from "zod";
import "zod-openapi/extend";
import { labelSummaryResponse } from "@peppol/api/labels/shared";

export const supplierResponse = z.object({
  id: z.string().openapi({
    description: "The ID of the supplier. Use it, or the external ID, wherever an endpoint takes a supplierId.",
    examples: ["sd_supp_01JQZ8X0M4T7RB6K9V2NDHW3PA"],
  }),
  teamId: z.string().openapi({
    description: "The ID of the team the supplier belongs to. Suppliers are team-wide, not per company.",
    examples: ["team_01JQZ8X0M4T7RB6K9V2NDHW3PA"],
  }),
  externalId: z.string().nullable().openapi({
    description: "Your own identifier for the supplier, if you set one. It is unique within the team, so you can address a supplier by the ID your system already uses.",
    examples: ["erp-supplier-2087"],
  }),
  name: z.string().openapi({
    description: "The supplier's name.",
    examples: ["Example Supplier BV"],
  }),
  vatNumber: z.string().nullable().openapi({
    description: "The supplier's VAT number, if recorded. An incoming invoice or credit note whose seller has exactly this VAT number is matched to the supplier.",
    examples: ["BE0428643097"],
  }),
  peppolAddresses: z.array(z.string()).openapi({
    description: "The supplier's Peppol addresses, each as `scheme:identifier`. An incoming invoice or credit note sent from one of these addresses is matched to the supplier. Empty when none were recorded.",
    examples: [["0208:0428643097"]],
  }),
  createdAt: z.string().datetime().openapi({
    description: "When the supplier was created.",
  }),
  updatedAt: z.string().datetime().openapi({
    description: "When the supplier was last changed.",
  }),
  labels: z.array(labelSummaryResponse).optional().openapi({
    description: "The labels assigned to the supplier. An incoming invoice or credit note matched to the supplier gets these labels when it is received.",
  }),
}).openapi({ ref: "Supplier" });

export const supplierIdParamSchema = z.object({
  supplierId: z.string().openapi({
    description: "The internal ID or external ID of the supplier",
  }),
});

