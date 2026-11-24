import { Server } from "@recommand/lib/api";
import { expect, test } from "bun:test";

type Operation = { operationId?: string; "x-irreversible"?: unknown };

// Importing the routes reads this configuration, though building the document
// neither connects to the database nor signs a token
process.env.DATABASE_URL ??= "postgres://openapi-test/openapi-test";
process.env.JWT_SECRET ??= "openapi-test";

const { default: peppol, registerOpenApiRoutes } = await import("../index");

test("the OpenAPI document marks the operations that can't be undone", async () => {
  const server = new Server();
  server.route("/api", peppol);
  registerOpenApiRoutes(server);
  const document = (await (await server.request("/openapi")).json()) as {
    paths: Record<string, Record<string, Operation>>;
  };

  const irreversible = Object.values(document.paths)
    .flatMap((item) => Object.values(item))
    .filter((operation) => operation["x-irreversible"] === true)
    .map(({ operationId }) => operationId);

  expect(irreversible.toSorted()).toEqual([
    "deleteCompany",
    "deleteCompanyDocumentType",
    "deleteCompanyIdentifier",
    "deleteCompanyNotificationEmailAddress",
    "deleteCustomer",
    "deleteDocument",
    "deleteLabel",
    "deleteSupplier",
    "deleteWebhook",
    "sendDocument",
    "submitFrenchB2BiReport",
    "submitFrenchB2CReport",
  ]);
});
