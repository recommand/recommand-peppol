import z from "zod";
import "zod-openapi/extend";

export const labelResponse = z.object({
    id: z.string().openapi({
        example: "lbl_01JQZ8X0M4T7RB6K9V2NDHW3PA",
        description: "The label's identifier, used wherever a label is assigned or unassigned.",
    }),
    teamId: z.string().openapi({
        description: "The team the label belongs to. Labels are team-wide, not per company.",
    }),
    externalId: z.string().nullable().openapi({
        example: "erp-routing-inbox",
        description: "Your own identifier for the label, if you set one. It is unique within the team, so you can address a label by the id your system already uses.",
    }),
    name: z.string().openapi({
        example: "ERP",
        description: "The label's name, as it is shown in the dashboard and returned on the documents and suppliers it is assigned to.",
    }),
    colorHex: z.string().openapi({
        example: "#3B82F6",
        description: "The colour the label is shown in, as a hex code.",
    }),
    createdAt: z.string().datetime().openapi({
        description: "When the label was created.",
    }),
    updatedAt: z.string().datetime().openapi({
        description: "When the label was last changed.",
    }),
});

