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
