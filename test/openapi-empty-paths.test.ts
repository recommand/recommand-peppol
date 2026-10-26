import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { describeRoute, generateSpecs } from 'hono-openapi';
import { withoutEmptyPaths, withoutUnusedSchemas } from '../utils/openapi';

describe('withoutEmptyPaths', () => {
  test('drops the path items hono-openapi leaves behind for hidden routes', async () => {
    const app = new Hono();
    app.get(
      '/visible',
      describeRoute({
        operationId: 'visible',
        responses: { 200: { description: 'ok' } },
      }),
      (c) => c.json({}),
    );
    app.post('/hidden', describeRoute({ hide: true }), (c) => c.json({}));

    const specs = await generateSpecs(app);

    // The bug this guards against: the operation is gone, the key is not.
    expect(Object.keys(specs.paths)).toEqual(['/visible', '/hidden']);
    expect(specs.paths['/hidden']).toEqual({});

    expect(Object.keys(withoutEmptyPaths(specs).paths)).toEqual(['/visible']);
  });

  test('keeps every path that has an operation, and the rest of the document', () => {
    const specs = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/kept': { get: { responses: {} } },
        '/dropped': {},
        '/also-dropped': {},
      },
      components: { schemas: { Thing: {} } },
    };

    const result = withoutEmptyPaths(specs);

    expect(Object.keys(result.paths)).toEqual(['/kept']);
    expect(result.components).toEqual(specs.components);
    expect(result.info).toEqual(specs.info);
    // The input is left alone; callers cache the result.
    expect(Object.keys(specs.paths)).toHaveLength(3);
  });

  test('passes through a document with no paths at all', () => {
    const specs: { openapi: string; paths?: Record<string, unknown> } = { openapi: '3.1.0' };
    expect(withoutEmptyPaths(specs)).toEqual(specs);
  });
});

test("omits hidden-only schemas while preserving transitive and recursive references", () => {
  const document = {
    paths: { "/visible": { get: { responses: { 200: { $ref: "#/components/responses/Visible" } } } } },
    components: {
      responses: { Visible: { schema: { $ref: "#/components/schemas/Parent" } } },
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      schemas: {
        Parent: { properties: { child: { $ref: "#/components/schemas/Child" } } },
        Child: { properties: { parent: { $ref: "#/components/schemas/Parent" } } },
        Hidden: { type: "object" },
      },
    },
  };
  const result = withoutUnusedSchemas(document);
  expect(Object.keys(result.components.schemas)).toEqual(["Parent", "Child"]);
  expect(result.components.securitySchemes).toEqual(document.components.securitySchemes);
  expect(Object.keys(document.components.schemas)).toContain("Hidden");
});
