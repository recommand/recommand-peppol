import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { exportJWK, generateKeyPair } from "jose";
import type { Pool } from "pg";
import { loadMcpTools } from "../utils/mcp";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// The Exchange tools as an MCP client reaches them: through Core's endpoint, with
// an OAuth grant, acting in the grant's team with the permissions it holds there.

let pool: Pool;
let app: Hono;
let authorization: string;

/** The JSON-RPC response to a request made with a credential, by default the one holding every permission. */
const send = async (method: string, params: Record<string, unknown> = {}, as = authorization) => {
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

const rpc = async (method: string, params: Record<string, unknown> = {}) => (await send(method, params)).result;

const callTool = async (name: string, args: Record<string, unknown> = {}) =>
  (await rpc("tools/call", { arguments: args, name })) as { isError?: boolean; structuredContent: Record<string, any> };

describe.skipIf(!testDatabaseUrl)("the Exchange MCP tools against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    process.env.JWT_SECRET ??= "mcp-tools-test-secret";
    process.env.BASE_URL ??= "https://recommand.example.com";
    process.env.SIGNING_KEYS = JSON.stringify({
      keys: [await exportJWK((await generateKeyPair("RS256", { extractable: true })).privateKey)],
    });

    await seedTeamAndCompany(pool);
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ('usr_member', 'member@example.com', 'unused')`);
    await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, 'usr_member')`, [TEAM_ID]);
    await pool.query(
      `INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES
        ('usr_member', $1, 'exchange.companies.read'), ('usr_member', $1, 'exchange.documents.read'),
        ('usr_member', $1, 'exchange.identifiers.read')`,
      [TEAM_ID]
    );
    await pool.query(`INSERT INTO oauth_clients (id, kind, grant_types, redirect_uris, token_endpoint_auth_method) VALUES
      ('dcr_app', 'dynamic', '{authorization_code}', '{https://app.example.com/callback}', 'none')`);

    await import("../../lib/permissions");
    await loadMcpTools();
    const { findClient } = await import("@core/data/oauth-clients");
    const { createGrant } = await import("@core/data/oauth-grants");
    const { issueTokens } = await import("@core/data/oauth-tokens");
    const client = (await findClient("dcr_app"))!;
    const authorize = async (permissionIds: string[]) => {
      const { grant } = await createGrant({ client, permissionIds, teamIds: [TEAM_ID], userId: "usr_member" });
      const { accessToken } = (await issueTokens({
        grantId: grant.id,
        resources: ["https://recommand.example.com/mcp"],
        withRefreshToken: false,
      }))!;

      return `Bearer ${accessToken}`;
    };
    authorization = await authorize(["exchange.companies.read", "exchange.documents.read", "exchange.identifiers.read"]);

    const { default: mcp } = await import("@core/api/mcp");
    app = new Hono();
    app.route("/", mcp as never);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("lists the tools the grant's permissions allow", async () => {
    const { tools } = await rpc("tools/list");
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_teams",
      "list_companies",
    ]);
  });

  it("lists the team's companies", async () => {
    const { structuredContent } = await callTool("list_companies");
    expect(structuredContent.companies).toEqual([
      expect.objectContaining({ country: "FR", id: COMPANY_ID, name: "Example SARL", peppolIds: [] }),
    ]);
  });

  it("pages through the companies, with their Peppol IDs", async () => {
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, access_point_provider, smp_provider)
       VALUES ('cmp_second', $1, 'Second BV', 'Kouter 1', '9000', 'Gent', 'BE', 'recommand-ap1', 'recommand-smp1')`,
      [TEAM_ID]
    );
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_second', 'cmp_second', '0208', '0123456749')`
    );

    expect((await callTool("list_companies", { limit: 1, page: 2 })).structuredContent).toEqual({
      companies: [expect.objectContaining({ id: "cmp_second", peppolIds: ["0208:0123456749"] })],
      pagination: { limit: 1, page: 2, total: 2, totalPages: 2 },
    });
  });

  it("says a company is registered on Peppol only when it would be registered", async () => {
    const { structuredContent } = await callTool("list_companies");

    // A French company on the production network has to be verified first
    expect(structuredContent.companies).toEqual([
      expect.objectContaining({ id: COMPANY_ID, isRegisteredOnPeppol: false }),
      expect.objectContaining({ id: "cmp_second", isRegisteredOnPeppol: true }),
    ]);
  });
});
