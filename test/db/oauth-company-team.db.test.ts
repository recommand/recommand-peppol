import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Pool } from "pg";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// An OAuth grant can cover several teams. On a route that names a company but no
// team, the request acts in the team the company belongs to.

const OTHER_TEAM_ID = "team_db_test_other";
// A team the grant doesn't cover, with a company of its own
const OUTSIDE_TEAM_ID = "team_db_test_outside";
const OUTSIDE_COMPANY_ID = "cmp_db_test_outside";

let pool: Pool;
let app: Hono;
let accessToken: string;

const call = (path: string) => app.request(path, { headers: { Authorization: `Bearer ${accessToken}` } });

describe.skipIf(!testDatabaseUrl)("OAuth grants for several teams on Peppol routes against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    process.env.JWT_SECRET ??= "oauth-company-team-test-secret";
    process.env.BASE_URL ??= "https://recommand.example.com";
    process.env.SIGNING_KEYS = JSON.stringify({
      keys: [await exportJWK((await generateKeyPair("RS256", { extractable: true })).privateKey)],
    });

    await seedTeamAndCompany(pool);
    await pool.query(`INSERT INTO teams (id, name) VALUES ($1, 'Other'), ($2, 'Outside')`, [OTHER_TEAM_ID, OUTSIDE_TEAM_ID]);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, access_point_provider, smp_provider)
       VALUES ($1, $2, 'Outside SARL', '1 Rue', '75001', 'Paris', 'FR', 'at-shared-ap-fr', 'at-shared-smp-fr')`,
      [OUTSIDE_COMPANY_ID, OUTSIDE_TEAM_ID]
    );
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ('usr_member', 'member@example.com', 'unused')`);
    await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, 'usr_member'), ($2, 'usr_member')`, [
      TEAM_ID,
      OTHER_TEAM_ID,
    ]);
    await pool.query(
      `INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES
        ('usr_member', $1, 'exchange.companies.read'), ('usr_member', $2, 'exchange.companies.read')`,
      [TEAM_ID, OTHER_TEAM_ID]
    );
    await pool.query(`INSERT INTO oauth_clients (id, kind, grant_types, redirect_uris, token_endpoint_auth_method) VALUES
      ('dcr_app', 'dynamic', '{authorization_code}', '{https://app.example.com/callback}', 'none')`);

    await import("../../lib/permissions");
    const { findClient } = await import("@core/data/oauth-clients");
    const { createGrant } = await import("@core/data/oauth-grants");
    const { issueTokens } = await import("@core/data/oauth-tokens");
    const { grant } = await createGrant({
      client: (await findClient("dcr_app"))!,
      permissionIds: ["exchange.companies.read"],
      teamIds: [TEAM_ID, OTHER_TEAM_ID],
      userId: "usr_member",
    });
    ({ accessToken } = (await issueTokens({ grantId: grant.id, resources: [], withRefreshToken: false }))!);

    const { requireIntegrationSupportedCompanyAccess, requireIntegrationSupportedTeamAccess, requirePermission } = await import(
      "../../utils/auth-middleware"
    );
    app = new Hono();
    const team = (c: { get: (key: "team") => { id: string } }) => Response.json({ team: c.get("team").id });
    app.get("/companies", requireIntegrationSupportedTeamAccess() as never, team as never);
    app.get(
      "/companies/:companyId",
      requireIntegrationSupportedTeamAccess() as never,
      requirePermission("exchange.companies.read") as never,
      team as never
    );
    app.get("/documents/:companyId", requireIntegrationSupportedCompanyAccess() as never, team as never);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("acts in the team of the company the path names", async () => {
    const response = await call(`/companies/${COMPANY_ID}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ team: TEAM_ID });
  });

  it("needs a team when the path names none", async () => {
    const response = await call("/companies");
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("team_required");
  });

  it("needs a team when the company is unknown", async () => {
    expect((await call("/companies/cmp_unknown")).status).toBe(400);
  });

  it("asks for the team of a company outside the grant on company routes", async () => {
    const response = await call(`/documents/${OUTSIDE_COMPANY_ID}`);
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
    expect(await (await call(`/documents/${COMPANY_ID}`)).json()).toEqual({ team: TEAM_ID });
  });

  it("tells a client its token is no longer valid on company routes", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "RS256", typ: "at+jwt" }).sign(privateKey);
    const response = await app.request(`/documents/${COMPANY_ID}`, { headers: { Authorization: `Bearer ${forged}` } });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });
});
