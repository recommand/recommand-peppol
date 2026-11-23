import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { describeRoute, generateSpecs, validator } from "hono-openapi";
import { z } from "zod";
import { withSortedParameters } from "../utils/openapi";

const filters = z.object({ status: z.string().optional(), author: z.string().optional() });

const names = (parameters: unknown) =>
  (parameters as { in: string; name: string }[]).map(({ in: location, name }) => `${location} ${name}`);

const documentFor = (query: z.AnyZodObject) => {
  const app = new Hono();
  app.get(
    "/notebooks/:notebookId/notes/:noteId",
    describeRoute({ operationId: "getNote", responses: { 200: { description: "ok" } } }),
    validator("header", z.object({ "x-trace": z.string().optional() })),
    validator("query", query),
    validator("param", z.object({ noteId: z.string(), notebookId: z.string() })),
    (c) => c.json({}),
  );

  return generateSpecs(app);
};

describe("withSortedParameters", () => {
  test("lists path parameters as they appear in the path, then query and header parameters by name", async () => {
    const specs = withSortedParameters(await documentFor(filters.extend({ page: z.string().optional() })));

    expect(names(specs.paths["/notebooks/{notebookId}/notes/{noteId}"]?.get?.parameters)).toEqual([
      "path notebookId",
      "path noteId",
      "query author",
      "query page",
      "query status",
      "header x-trace",
    ]);
  });

  test("gives a schema built from shared parts the same order as one written out", async () => {
    const page = z.object({ page: z.string().optional() });
    const [merged, written] = await Promise.all([
      documentFor(page.merge(filters)),
      documentFor(z.object({ author: z.string().optional(), page: z.string().optional(), status: z.string().optional() })),
    ]);

    expect(withSortedParameters(merged).paths).toEqual(withSortedParameters(written).paths);
  });

  test("sorts a `$ref` as the parameter it names, and keeps one it can't resolve after the others", () => {
    const page = { $ref: "#/components/parameters/Page" };
    const unknown = { $ref: "#/components/parameters/Unknown" };
    const specs = {
      components: { parameters: { Page: { in: "query", name: "page" } } },
      info: { title: "Notes", version: "1" },
      openapi: "3.1.0",
      paths: {
        "/notes": {
          get: {
            parameters: [unknown, { in: "query", name: "status" }, page, { in: "query", name: "author" }],
            responses: {},
          },
          parameters: [{ in: "header", name: "x-trace" }],
        },
      },
    };

    expect(withSortedParameters(specs)).toEqual({
      ...specs,
      paths: {
        "/notes": {
          get: { parameters: [{ in: "query", name: "author" }, page, { in: "query", name: "status" }, unknown], responses: {} },
          parameters: [{ in: "header", name: "x-trace" }],
        },
      },
    });
  });
});
