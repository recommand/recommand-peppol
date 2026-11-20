type Parameter = { $ref?: string; in?: string; name?: string };

const PARAMETER_LOCATIONS = ["path", "query", "header", "cookie"];

const PARAMETER_REFERENCE = "#/components/parameters/";

const isParameterList = (value: unknown): value is Parameter[] => Array.isArray(value);

// A `$ref` sorts as the parameter component it names
const resolved = (parameter: Parameter, components: Record<string, Parameter>): Parameter => {
  if (!parameter.$ref?.startsWith(PARAMETER_REFERENCE)) {
    return parameter;
  }

  const name = parameter.$ref.slice(PARAMETER_REFERENCE.length).replace(/~1/g, "/").replace(/~0/g, "~");

  return components[name] ?? {};
};

// A parameter without a known location, such as a `$ref` that names no parameter
// component, goes last and keeps its place among the others like it
const locationRank = ({ in: location }: Parameter) => {
  const rank = PARAMETER_LOCATIONS.indexOf(location ?? "");

  return rank === -1 ? PARAMETER_LOCATIONS.length : rank;
};

const sortedParameters = (path: string, parameters: Parameter[], components: Record<string, Parameter>) =>
  parameters.toSorted((first, second) => {
    const [a, b] = [resolved(first, components), resolved(second, components)];

    if (locationRank(a) !== locationRank(b)) {
      return locationRank(a) - locationRank(b);
    }

    if (a.in === "path") {
      return path.indexOf(`{${a.name}}`) - path.indexOf(`{${b.name}}`);
    }

    const [firstName, secondName] = [a.name ?? "", b.name ?? ""];

    return firstName < secondName ? -1 : firstName > secondName ? 1 : 0;
  });

/**
 * List every operation's parameters in a fixed order: path parameters as they
 * appear in the path, then query, header and cookie parameters, each by name.
 *
 * `hono-openapi` lists them in the key order of the validators' schemas, so
 * building a schema from shared parts, with `.merge()` or `.extend()`, reorders
 * the published parameters although none of them changed.
 *
 * https://github.com/rhinobase/hono-openapi/pull/332 proposes this order
 * upstream, as the `sortParameters` option; until the `hono-openapi` release
 * this package uses has it, the document is sorted here.
 */
export const withSortedParameters = <
  T extends { components?: { parameters?: Record<string, unknown> }; paths?: Record<string, unknown> },
>(specs: T): T => {
  if (!specs.paths) {
    return specs;
  }

  const components = (specs.components?.parameters ?? {}) as Record<string, Parameter>;
  const paths = Object.fromEntries(
    Object.entries(specs.paths).map(([path, item]) => {
      if (item === null || typeof item !== "object") {
        return [path, item];
      }

      const sortedItem = Object.fromEntries(
        Object.entries(item).map(([key, value]) => {
          if (key === "parameters" && isParameterList(value)) {
            return [key, sortedParameters(path, value, components)];
          }

          if (value !== null && typeof value === "object" && "parameters" in value && isParameterList(value.parameters)) {
            return [key, { ...value, parameters: sortedParameters(path, value.parameters, components) }];
          }

          return [key, value];
        }),
      );

      return [path, sortedItem];
    }),
  );

  return { ...specs, paths };
};

/**
 * Marks an operation whose effect can't be undone, as the `x-irreversible`
 * extension: a sent document or a filed report can't be called back, and a
 * deleted resource can't be restored. The HTTP method doesn't tell a client
 * this, since a `POST` can be as harmless as a lookup (verifying a recipient is
 * one), so a client or an agent reads the extension to ask before calling.
 */
export const irreversible = { "x-irreversible": true };
