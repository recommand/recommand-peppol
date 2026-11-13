import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import type { Pool } from "pg";
import { loadMcpTools } from "../utils/mcp";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// Sending through the MCP server, as an assistant does.

const SEND_TOOLS = ["describe_document"];

let pool: Pool;
let app: Hono;
let sender: string;
let reader: string;

/** The JSON-RPC response to a request, by default made with the key that may send. */
const rpc = async (method: string, params: Record<string, unknown> = {}, as = sender) => {
  const response = await app.request("/mcp", {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: as,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    method: "POST",
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  // A response streamed as server-sent events carries its message on a `data:` line
  const body = text.startsWith("{") ? text : text.split("\n").find((line) => line.startsWith("data: "))!.slice(6);

  return JSON.parse(body);
};

const callTool = async (name: string, args: Record<string, unknown>, as = sender) =>
  (await rpc("tools/call", { arguments: args, name }, as)).result as { isError?: boolean; structuredContent: Record<string, any> };

/** An API key in the team, holding the permissions given, as its owner does. */
const seedKey = async (id: string, permissionIds: string[]) => {
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'unused')`, [`usr_${id}`, `${id}@example.com`]);
  await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, [TEAM_ID, `usr_${id}`]);
  await pool.query(`INSERT INTO api_keys (id, name, team_id, user_id, secret_hash) VALUES ($1, 'Key', $2, $3, $4)`, [
    id,
    TEAM_ID,
    `usr_${id}`,
    await Bun.password.hash("secret", { algorithm: "bcrypt", cost: 4 }),
  ]);
  for (const permissionId of permissionIds) {
    await pool.query(`INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES ($1, $2, $3)`, [`usr_${id}`, TEAM_ID, permissionId]);
    await pool.query(
      `INSERT INTO principal_permissions (principal_type, principal_id, team_id, permission_id) VALUES ('api_key', $1, $2, $3)`,
      [id, TEAM_ID, permissionId]
    );
  }

  return `Basic ${Buffer.from(`${id}:secret`).toString("base64")}`;
};

describe.skipIf(!testDatabaseUrl)("sending through the MCP server against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    // The validation service is a service of its own; what it does isn't what's tested here
    mock.module("../../utils/pipelines/sending/validate-document", () => ({
      validateDocument: async () => ({ errors: [], result: "valid" }),
    }));
    process.env.JWT_SECRET ??= "mcp-sending-test-secret";
    process.env.BASE_URL ??= "https://recommand.example.com";

    await seedTeamAndCompany(pool);
    await pool.query(
      `UPDATE peppol_companies SET country = 'BE', enterprise_number_scheme = '0208', enterprise_number = '0123456749', vat_number = 'BE0123456749',
         is_verified = true, access_point_provider = 'recommand-ap1', smp_provider = 'recommand-smp1' WHERE id = $1`,
      [COMPANY_ID]
    );
    await pool.query(`INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_mcp', $1, '0208', '0123456749')`, [
      COMPANY_ID,
    ]);
    sender = await seedKey("key_sender", ["exchange.documents.send"]);
    reader = await seedKey("key_reader", ["exchange.documents.read"]);

    (await import("../../lib/event-types")).registerPeppolEventTypes();
    await import("../../lib/permissions");
    await loadMcpTools();
    const { default: mcp } = await import("@core/api/mcp");
    app = new Hono();
    app.route("/", mcp as never);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("offers the send tools only to a credential that may send", async () => {
    const names = async (as: string) => (await rpc("tools/list", {}, as)).result.tools.map((tool: { name: string }) => tool.name);

    expect(await names(sender)).toEqual(expect.arrayContaining(SEND_TOOLS));
    expect((await names(reader)).filter((name: string) => SEND_TOOLS.includes(name))).toEqual([]);
  });

  it("describes a document type's fields, and raw XML as a string", async () => {
    const { isError, structuredContent } = await callTool("describe_document", { documentType: "invoice" });

    expect(isError).toBeFalsy();
    expect(structuredContent.documentType).toBe("invoice");
    expect(structuredContent.schema.properties).toHaveProperty("invoiceNumber");
    expect(structuredContent.schema.properties).toHaveProperty("lines");
    expect(structuredContent.schema.$defs).toBeObject();
    expect((await callTool("describe_document", { documentType: "xml" })).structuredContent.schema).toMatchObject({ type: "string" });
  });
});
