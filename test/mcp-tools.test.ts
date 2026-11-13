import { expect, mock, test } from "bun:test";
import { loadMcpTools } from "./utils/mcp";

// Only the tools' definitions are read, never the database
mock.module("@recommand/db", () => ({ db: {} }));
// Loading the routes loads the authentication, which needs a secret to be set
process.env.JWT_SECRET ??= "mcp-tools-test-secret";
const { getRegisteredTools, getToolPermissions } = await import("@core/lib/mcp/tools");
const { toToolDefinition } = await import("@core/lib/mcp/definitions");
await loadMcpTools();

// A change to a tool's name, input or annotations changes what models were told,
// so it shows up here and is made on purpose
test("the MCP tools stay as models know them", () => {
  expect(getRegisteredTools().map(toToolDefinition)).toMatchSnapshot();
});

// Each tool needs every permission of the API operations it does the work of, read from the
// document `/openapi` serves, so a route whose permission changes takes its tools along
test("the MCP tools need the permissions of the API operations they stand for", async () => {
  const tools = getRegisteredTools();
  const permissions = await Promise.all(tools.map(getToolPermissions));

  expect(Object.fromEntries(tools.map(({ name }, index) => [name, permissions[index]]))).toEqual({
    get_document: ["exchange.documents.read"],
    list_companies: ["exchange.companies.read", "exchange.identifiers.read"],
    search_documents: ["exchange.documents.read"],
  });
});
