// The API document declares OpenAPI 3.1, whose Schema Objects are JSON Schema
// 2020-12 and carry example values in `examples`, an array. The schema
// metadata in this codebase uses the OpenAPI 3.0 keyword `example`, which 3.1
// keeps only as a deprecated alias, and tools that follow 3.1 strictly, such
// as documentation renderers and SDK generators, then show no example values.
// Rather than change every schema definition, the generated document is
// rewritten before it is served.

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON Schema keywords whose values are subschemas.
const subschemaMaps = [
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
];
const subschemaLists = ["allOf", "anyOf", "oneOf", "prefixItems"];
const subschemas = [
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
];

function mapValues(
  object: JsonObject,
  fn: (value: unknown) => unknown
): JsonObject {
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, fn(value)])
  );
}

/**
 * Return a copy of a Schema Object in which every schema, nested ones
 * included, that has `example` and no `examples` carries `examples: [example]`
 * instead.
 */
function normalizeSchema(schema: unknown): unknown {
  if (!isObject(schema)) return schema;
  const convert = "example" in schema && !("examples" in schema);
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (convert && key === "example") result.examples = [value];
    else if (subschemaMaps.includes(key) && isObject(value))
      result[key] = mapValues(value, normalizeSchema);
    else if (subschemaLists.includes(key) && Array.isArray(value))
      result[key] = value.map(normalizeSchema);
    else if (subschemas.includes(key)) result[key] = normalizeSchema(value);
    else result[key] = value;
  }
  return result;
}

/**
 * Return a copy of an OpenAPI 3.1 document in which the Schema Objects use
 * `examples` instead of `example`. Schemas are found under every `schema` key
 * and in `components.schemas`. The `example` fields of Parameter, Media Type
 * and Header Objects are valid in 3.1 and stay as they are, and example values
 * themselves are never rewritten. The input is not modified.
 */
export function normalizeSchemaExamples<T>(document: T): T {
  return normalizeNode(document) as T;
}

function normalizeNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeNode);
  if (!isObject(node)) return node;
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "schema") result[key] = normalizeSchema(value);
    else if (key === "schemas" && isObject(value))
      result[key] = mapValues(value, normalizeSchema);
    else if (key === "example" || key === "examples") result[key] = value;
    else result[key] = normalizeNode(value);
  }
  return result;
}
