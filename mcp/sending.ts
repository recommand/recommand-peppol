import { z } from "zod";
import "zod-openapi/extend";
import { createSchema } from "zod-openapi";
import { registerTool } from "@core/lib/mcp/tools";
import { documentSendSchema, documentTypeSchema } from "@peppol/utils/parsing/send-document";

registerTool({
  annotations: { openWorldHint: false, readOnlyHint: true },
  description:
    "Get the fields of a document type, as JSON Schema: what a send request takes as `document` for that `documentType`. Call it before writing a document of a type you haven't written yet.",
  handler: async (_, { documentType }) => {
    const { components = {}, schema } = createSchema(documentSendSchema(documentType), {
      componentRefPath: "#/$defs/",
      schemaType: "input",
    });
    // A named schema comes back as a reference to itself; the model reads it more easily written out
    const rootName = "$ref" in schema ? schema.$ref.replace("#/$defs/", "") : null;
    const { [rootName ?? ""]: root, ...definitions } = components as Record<string, object>;

    return {
      documentType,
      schema: { ...(root ?? schema), ...(Object.keys(definitions).length > 0 ? { $defs: definitions } : {}) },
    };
  },
  input: z.object({
    documentType: documentTypeSchema.openapi({
      description: "The document type to describe, such as `invoice`.",
    }),
  }),
  name: "describe_document",
  operations: ["sendDocument"],
  title: "Describe a document type",
});
