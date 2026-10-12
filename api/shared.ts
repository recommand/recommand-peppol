import z from "zod";
import "zod-openapi/extend";

/** The page a list endpoint returns alongside its items. */
export const paginationResponse = z
    .object({
        limit: z.number().openapi({ description: "Maximum number of items on a page." }),
        page: z.number().openapi({ description: "The page returned, counting from 1." }),
        total: z.number().openapi({ description: "Total number of items across all pages." }),
        totalPages: z.number().openapi({ description: "Number of pages at this page size." }),
    })
    .openapi({ ref: "Pagination" });
