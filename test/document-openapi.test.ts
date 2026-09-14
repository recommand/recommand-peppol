import { expect, test } from "bun:test";
import { createSchema } from "zod-openapi";
import { transmittedDocumentResponse } from "../api/documents/shared";

test("document OpenAPI includes invoice delivery details and document delivery status", () => {
  const result = createSchema(transmittedDocumentResponse);
  const components = result.components as Record<string, any>;
  expect(components.Delivery.properties).toHaveProperty("location");
  expect(components.DocumentDelivery.properties).toHaveProperty("status");
  expect(components.DocumentDelivery.properties).toHaveProperty("references");
  expect(JSON.stringify(result)).toContain("#/components/schemas/DocumentDelivery");
});
