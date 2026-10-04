import { describe, expect, it } from "bun:test";
import { normalizeSchemaExamples } from "../utils/openapi-schema-examples";

// The result has a different shape than its input, so read it untyped.
const normalize = (document: object): any => normalizeSchemaExamples(document);

describe("normalizeSchemaExamples", () => {
  it("turns a component schema's example into examples", () => {
    const document = {
      components: {
        schemas: {
          Company: { type: "string", example: "c_01" },
        },
      },
    };
    expect(normalize(document)).toEqual({
      components: {
        schemas: {
          Company: { type: "string", examples: ["c_01"] },
        },
      },
    });
  });

  it("converts nested schemas through every subschema keyword", () => {
    const leaf = (example: unknown) => ({ type: "string", example });
    const converted = (example: unknown) => ({
      type: "string",
      examples: [example],
    });
    const schema = {
      type: "object",
      example: { id: "d_01" },
      properties: { id: leaf("d_01") },
      patternProperties: { "^x-": leaf("x") },
      $defs: { Id: leaf("id") },
      allOf: [leaf("all")],
      anyOf: [leaf("any")],
      oneOf: [leaf("one")],
      prefixItems: [leaf("prefix")],
      items: leaf("item"),
      additionalProperties: leaf("extra"),
      not: leaf("not"),
      dependentSchemas: { id: leaf("dependent") },
      unevaluatedProperties: leaf("unevaluated"),
      unevaluatedItems: leaf("unevaluatedItem"),
      contains: leaf("contains"),
      propertyNames: leaf("name"),
      // Built from entries: a literal `then` key makes the object thenable.
      ...Object.fromEntries(["if", "then", "else"].map((k) => [k, leaf(k)])),
    };
    const result = normalize({ schema });
    expect(result.schema).toEqual({
      type: "object",
      examples: [{ id: "d_01" }],
      properties: { id: converted("d_01") },
      patternProperties: { "^x-": converted("x") },
      $defs: { Id: converted("id") },
      allOf: [converted("all")],
      anyOf: [converted("any")],
      oneOf: [converted("one")],
      prefixItems: [converted("prefix")],
      items: converted("item"),
      additionalProperties: converted("extra"),
      not: converted("not"),
      dependentSchemas: { id: converted("dependent") },
      unevaluatedProperties: converted("unevaluated"),
      unevaluatedItems: converted("unevaluatedItem"),
      contains: converted("contains"),
      propertyNames: converted("name"),
      ...Object.fromEntries(
        ["if", "then", "else"].map((k) => [k, converted(k)])
      ),
    });
  });

  it("converts inline schemas in parameters, request bodies, responses and headers", () => {
    const document = {
      paths: {
        "/companies/{companyId}": {
          post: {
            parameters: [
              {
                name: "companyId",
                in: "path",
                example: "c_01",
                schema: { type: "string", example: "c_01" },
              },
            ],
            requestBody: {
              content: {
                "application/json": {
                  example: { name: "Acme" },
                  schema: { type: "object", example: { name: "Acme" } },
                },
              },
            },
            responses: {
              200: {
                headers: {
                  "X-Request-Id": {
                    example: "r_01",
                    schema: { type: "string", example: "r_01" },
                  },
                },
                content: {
                  "application/json": {
                    schema: { type: "boolean", example: true },
                  },
                },
              },
            },
          },
        },
      },
    };
    const operation = normalize(document).paths["/companies/{companyId}"].post;
    const parameter = operation.parameters[0];
    const requestBody = operation.requestBody.content["application/json"];
    const response = operation.responses[200];
    const header = response.headers["X-Request-Id"];

    expect(parameter.schema).toEqual({ type: "string", examples: ["c_01"] });
    expect(requestBody.schema).toEqual({
      type: "object",
      examples: [{ name: "Acme" }],
    });
    expect(header.schema).toEqual({ type: "string", examples: ["r_01"] });
    expect(response.content["application/json"].schema).toEqual({
      type: "boolean",
      examples: [true],
    });

    // Parameter, Media Type and Header Objects keep `example`, valid in 3.1.
    expect(parameter.example).toBe("c_01");
    expect(requestBody.example).toEqual({ name: "Acme" });
    expect(header.example).toBe("r_01");
  });

  it("keeps a schema's examples when it already has them", () => {
    const schema = { type: "string", example: "a", examples: ["b"] };
    expect(normalize({ schema }).schema).toEqual(schema);
  });

  it("keeps falsy example values", () => {
    const result = normalize({
      components: {
        schemas: {
          Count: { type: "integer", example: 0 },
          Note: { type: ["string", "null"], example: null },
        },
      },
    });
    expect(result.components.schemas.Count.examples).toEqual([0]);
    expect(result.components.schemas.Note.examples).toEqual([null]);
  });

  it("does not rewrite example values that look like schemas", () => {
    const document = {
      paths: {
        "/": {
          get: {
            responses: {
              200: {
                content: {
                  "application/json": {
                    examples: {
                      sample: { value: { schema: { example: "data" } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(normalize(document)).toEqual(document);
  });

  it("leaves boolean schemas and references alone", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { company: { $ref: "#/components/schemas/Company" } },
    };
    expect(normalize({ schema }).schema).toEqual(schema);
  });

  it("does not modify the input document", () => {
    const document = {
      components: { schemas: { Id: { type: "string", example: "c_01" } } },
    };
    const copy = structuredClone(document);
    normalize(document);
    expect(document).toEqual(copy);
  });
});
