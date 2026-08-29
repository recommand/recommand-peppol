import { z } from "zod";

export const validationError = z.object({
    ruleCode: z.string().nullish(),
    errorMessage: z.string(),
    errorLevel: z.string(),
    fieldName: z.string().nullish(),
    source: z.string().optional(),
});

export const validationResult = z.enum(["valid", "invalid", "not_supported", "error"]);

export const validationResponse = z.object({
  result: validationResult,
  errors: z.array(validationError),
});

export type ValidationResponse = z.infer<typeof validationResponse>;
