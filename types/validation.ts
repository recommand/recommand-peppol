import { z } from "zod";
import "zod-openapi/extend";

export const validationError = z.object({
    ruleCode: z.string().nullish().openapi({
        description: "The identifier of the rule that was violated, for example an EN 16931 or Peppol BIS business rule code. Null for findings that come from something other than a coded rule, such as a schema error.",
        example: "PEPPOL-EN16931-R010",
    }),
    errorMessage: z.string().openapi({
        description: "What the rule expected, in the words of the ruleset that raised it.",
    }),
    errorLevel: z.string().openapi({
        description: "How serious the finding is. Only findings the ruleset treats as errors make a document invalid.",
        example: "ERROR",
    }),
    fieldName: z.string().nullish().openapi({
        description: "Where in the document the finding applies, usually as an XPath. Null when the finding is not tied to one place.",
    }),
    source: z.string().optional().openapi({
        description: "Which ruleset produced the finding, for example the syntax schema or a Peppol business rule set.",
    }),
});

export const validationResult = z.enum(["valid", "invalid", "not_supported", "error"]);

export const validationResponse = z.object({
  result: validationResult.openapi({
    description: "`valid`: the document passed every rule that applies to it. `invalid`: at least one rule was violated; see `errors`. `not_supported`: no ruleset is available for this document type, so nothing was checked. `error`: the validation service could not be reached or its answer could not be read.",
    example: "valid",
  }),
  errors: z.array(validationError).openapi({
    description: "The findings the validation produced. Empty when the document is valid, and also when the result is `not_supported` or `error`.",
  }),
});

export type ValidationResponse = z.infer<typeof validationResponse>;
