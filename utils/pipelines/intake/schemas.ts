import type { JSONSchema7 } from "ai";
import { z } from "zod";
import { createSchema } from "zod-openapi";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";

/** Fields a model must not fill: they are not printed on the document. */
const OMITTED_FIELDS = ["attachments"];

export const EXTRACTION_FINDING_CODES = ["uncertain_value", "missing_value"] as const;

/** What the extraction model returns for one PDF. */
export type ExtractionOutput = {
  document: unknown;
  findings: { pointer: string; code: (typeof EXTRACTION_FINDING_CODES)[number]; message: string }[];
  multipleDocuments: boolean;
};

/** Examples help a reader of the API, but they would only be copied by a model. */
function withoutExamples(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutExamples);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "examples" && key !== "example")
        .map(([key, item]) => [key, withoutExamples(item)]),
    );
  }
  return value;
}

const cache = new Map<string, JSONSchema7>();

/**
 * The JSON schema of the extraction output for a document type: the type's own
 * document schema, without the fields a model must not fill, next to the findings
 * and the multiple-documents flag. Generic: it reads nothing but the document schema,
 * whose descriptions become the descriptions the model reads.
 */
export function extractionSchema(documentType: AnyDocumentType): JSONSchema7 {
  const cached = cache.get(documentType.key);
  if (cached) {
    return cached;
  }
  const schema = documentType.documentSchema;
  const documentSchema =
    schema instanceof z.ZodObject
      ? schema.omit(Object.fromEntries(OMITTED_FIELDS.map((field) => [field, true])))
      : schema;
  const { schema: document, components } = createSchema(documentSchema, {
    schemaType: "input",
    componentRefPath: "#/$defs/",
  });
  const result = withoutExamples({
    type: "object",
    additionalProperties: false,
    required: ["document", "findings", "multipleDocuments"],
    properties: {
      document,
      findings: {
        type: "array",
        description: "Every value that is printed but not legible with certainty, and every expected value that is not printed.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["pointer", "code", "message"],
          properties: {
            pointer: {
              type: "string",
              description: "JSON Pointer into `document` to the field concerned, for example /invoiceNumber.",
            },
            code: {
              type: "string",
              enum: [...EXTRACTION_FINDING_CODES],
              description: "uncertain_value: the value is printed but could be read wrongly. missing_value: the value is not printed.",
            },
            message: { type: "string", description: "One sentence that explains the finding." },
          },
        },
      },
      multipleDocuments: {
        type: "boolean",
        description: "True when the PDF contains more than one business document, for example two invoices.",
      },
    },
    $defs: components ?? {},
  }) as JSONSchema7;
  cache.set(documentType.key, result);
  return result;
}
