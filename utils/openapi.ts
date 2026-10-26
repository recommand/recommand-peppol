/**
 * Drop path items that carry no operations.
 *
 * `hono-openapi` removes a hidden route's operation but leaves its parent key
 * behind, so every `describeRoute({ hide: true })` route still publishes its
 * URL as an empty object. Documentation viewers skip path items that hold no
 * operations, so this is invisible while reading the reference, but the keys
 * are there in the served JSON, which is what generators and other API clients
 * consume. A route hidden on purpose should not publish its path.
 *
 * Fixed upstream in hono-openapi 1.2.0 by
 * https://github.com/rhinobase/hono-openapi/pull/208. We are on 0.4.8, and
 * taking the fix means the whole 1.x migration, so drop the leftovers here
 * until that happens.
 */
export function withoutEmptyPaths<T extends { paths?: Record<string, unknown> }>(specs: T): T {
  if (!specs.paths) {
    return specs;
  }

  const paths = Object.fromEntries(
    Object.entries(specs.paths).filter(([, item]) => item != null && Object.keys(item).length > 0),
  );

  return { ...specs, paths };
}

export function withoutUnusedSchemas<T extends {
  components?: { schemas?: Record<string, unknown>; [key: string]: unknown };
}>(specs: T): T {
  if (!specs.components?.schemas) return specs;
  const reached = new Set<string>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref" && typeof item === "string" && item.startsWith("#/components/") && !reached.has(item)) {
        reached.add(item);
        const segments = item.slice(2).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"));
        let target: unknown = specs;
        for (const segment of segments) {
          target = target && typeof target === "object" ? (target as Record<string, unknown>)[segment] : undefined;
        }
        visit(target);
      } else {
        visit(item);
      }
    }
  };
  const { components, ...document } = specs;
  visit(document);
  for (const [kind, entries] of Object.entries(components)) {
    if (kind !== "schemas") visit(entries);
  }
  return {
    ...specs,
    components: {
      ...components,
      schemas: Object.fromEntries(Object.entries(components.schemas ?? {}).filter(([name]) =>
        reached.has(`#/components/schemas/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`))),
    },
  };
}
