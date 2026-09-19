import z from "zod";
import "zod-openapi/extend";

export const companyIdentifierResponse = z.object({
    id: z.string().openapi({
        description: "The ID of the identifier record. Use it with the get, update and delete identifier endpoints.",
        example: "ci_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    companyId: z.string().openapi({
        description: "The ID of the company this identifier belongs to.",
        example: "c_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    scheme: z.string().openapi({
        description: "The Peppol identifier scheme, an ISO/IEC 6523 ICD code. It says which register the identifier comes from, for example `0208` for the Belgian enterprise number register.",
        example: "0208",
    }),
    identifier: z.string().openapi({
        description: "The value within the scheme. Together with the scheme it forms the company's Peppol address, written as `scheme:identifier`.",
        example: "1012081766",
    }),
    createdAt: z.string().datetime().openapi({
        description: "When the identifier was added to the company.",
    }),
    updatedAt: z.string().datetime().openapi({
        description: "When the identifier was last changed.",
    }),
});

export const participantMigrationResponse = z.object({
    id: z.string().openapi({
        description: "The ID of the migration record.",
        example: "pm_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    companyId: z.string().openapi({
        description: "The ID of the company the identifier belongs to.",
        example: "c_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    scheme: z.string().openapi({
        description: "The scheme of the identifier being migrated.",
        example: "0208",
    }),
    identifier: z.string().openapi({
        description: "The value of the identifier being migrated.",
        example: "1012081766",
    }),
    direction: z.enum(["inbound", "outbound"]).openapi({
        description: "`inbound` moves the identifier from another provider to Recommand, `outbound` moves it away from Recommand.",
    }),
    status: z.enum(["pending", "inProgress", "completed", "cancelled", "failed"]).openapi({
        description: "`pending`: the key is stored and is used as soon as the company is registered in the SMP, which for teams with strict verification is when the company passes its identity check. `inProgress`: an outbound key was issued and the receiving provider has not claimed the identifier yet. `completed`: the identifier moved. `failed`: the SML refused the key; see `errorMessage`.",
    }),
    migrationKey: z.string().openapi({
        description: "The migration key. For an outbound migration this is the key to hand to the new provider.",
    }),
    errorMessage: z.string().nullable().openapi({
        description: "Why the migration failed or was cancelled, when it did.",
    }),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable().openapi({
        description: "When the migration reached a final status.",
    }),
});
