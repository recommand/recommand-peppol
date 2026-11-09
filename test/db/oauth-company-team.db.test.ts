import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type { AuthenticatedTeamContext, AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Pool } from "pg";
import { COMPANY_ID, connectTestDatabase, seedTeamAndCompany, TEAM_ID, testDatabaseUrl } from "./harness";

// An OAuth grant can cover several teams. On a route that names a company but no
// team, the request acts in the team the company belongs to.

const OTHER_TEAM_ID = "team_db_test_other";
// A team of the user that the grant doesn't cover, with a company of its own
const UNGRANTED_TEAM_ID = "team_db_test_ungranted";
const UNGRANTED_COMPANY_ID = "cmp_db_test_ungranted";
// A team the user isn't a member of, with a company of its own
const OUTSIDE_TEAM_ID = "team_db_test_outside";
const OUTSIDE_COMPANY_ID = "cmp_db_test_outside";
const previousEnvironment = { BASE_URL: process.env.BASE_URL, JWT_SECRET: process.env.JWT_SECRET, SIGNING_KEYS: process.env.SIGNING_KEYS };

let pool: Pool;
let app: Hono;
let accessToken: string;
// From a grant for one team, which acts in that team when the path names a company it can't reach
let singleTeamAccessToken: string;

const call = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } });

describe.skipIf(!testDatabaseUrl)("OAuth grants for several teams on Peppol routes against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    process.env.JWT_SECRET = "oauth-company-team-test-secret";
    process.env.BASE_URL = "https://recommand.example.com";
    process.env.SIGNING_KEYS = JSON.stringify({
      keys: [await exportJWK((await generateKeyPair("RS256", { extractable: true })).privateKey)],
    });

    await seedTeamAndCompany(pool);
    await pool.query(`INSERT INTO teams (id, name) VALUES ($1, 'Other'), ($2, 'Ungranted'), ($3, 'Outside')`, [
      OTHER_TEAM_ID,
      UNGRANTED_TEAM_ID,
      OUTSIDE_TEAM_ID,
    ]);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, access_point_provider, smp_provider)
       VALUES ($1, $2, 'Ungranted SARL', '1 Rue', '75001', 'Paris', 'FR', 'at-shared-ap-fr', 'at-shared-smp-fr'),
         ($3, $4, 'Outside SARL', '1 Rue', '75001', 'Paris', 'FR', 'at-shared-ap-fr', 'at-shared-smp-fr')`,
      [UNGRANTED_COMPANY_ID, UNGRANTED_TEAM_ID, OUTSIDE_COMPANY_ID, OUTSIDE_TEAM_ID]
    );
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ('usr_member', 'member@example.com', 'unused')`);
    await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, 'usr_member'), ($2, 'usr_member'), ($3, 'usr_member')`, [
      TEAM_ID,
      OTHER_TEAM_ID,
      UNGRANTED_TEAM_ID,
    ]);
    await pool.query(
      `INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES
        ('usr_member', $1, 'exchange.companies.read'), ('usr_member', $2, 'exchange.companies.read'),
        ('usr_member', $3, 'exchange.companies.read'), ('usr_member', $1, 'exchange.webhooks.read')`,
      [TEAM_ID, OTHER_TEAM_ID, UNGRANTED_TEAM_ID]
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
    const { grant: singleTeamGrant } = await createGrant({
      client: (await findClient("dcr_app"))!,
      permissionIds: ["exchange.companies.read"],
      teamIds: [TEAM_ID],
      userId: "usr_member",
    });
    ({ accessToken: singleTeamAccessToken } = (await issueTokens({
      grantId: singleTeamGrant.id,
      resources: [],
      withRefreshToken: false,
    }))!);

    const { default: companies } = await import("../../api/companies");
    const { default: webhooks } = await import("../../api/webhooks");
    const { requireIntegrationSupportedCompanyAccess } = await import("../../utils/auth-middleware");
    const documents = new Hono<AuthenticatedUserContext & AuthenticatedTeamContext>();
    documents.get("/documents/:companyId", requireIntegrationSupportedCompanyAccess(), (c) => c.json({ team: c.get("team").id }));
    app = new Hono();
    app.route("/", companies);
    app.route("/", documents);
    app.route("/", webhooks);
  }, 60_000);

  afterAll(async () => {
    Object.entries(previousEnvironment).forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });

    await pool?.end();
  });

  it("acts in the team of the company the path names", async () => {
    const response = await call(`/companies/${COMPANY_ID}`);
    expect(response.status).toBe(200);
    expect((await response.json()).company.id).toBe(COMPANY_ID);
  });

  it("needs a team when the path names none", async () => {
    const response = await call("/companies");
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("team_required");
  });

  it("answers 404 for a company that doesn't exist", async () => {
    expect((await call("/companies/cmp_unknown")).status).toBe(404);
  });

  it("finds the company's team on the routes that change a company too, then checks the permission", async () => {
    const response = await call(`/companies/${COMPANY_ID}`, { body: "{}", method: "PUT" });
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="exchange.companies.write"');
    expect((await response.json()).code).toBe("insufficient_permission");
  });

  it("asks for the team of a company the user can add to the grant", async () => {
    const response = await call(`/documents/${UNGRANTED_COMPANY_ID}`);
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
    expect(await (await call(`/documents/${COMPANY_ID}`)).json()).toEqual({ team: TEAM_ID });
    const { rows } = await pool.query("SELECT object_id, subsystem FROM audit_events WHERE reason_code = 'not_in_grant'");
    expect(rows).toContainEqual({ object_id: UNGRANTED_TEAM_ID, subsystem: "core.team_access" });
  });

  it("answers a company in a team the user isn't a member of like one that doesn't exist", async () => {
    const outside = await call(`/documents/${OUTSIDE_COMPANY_ID}`);
    const unknown = await call("/documents/cmp_unknown");
    expect([outside.status, await outside.json()]).toEqual([unknown.status, await unknown.json()]);
    expect(outside.status).toBe(404);
    expect(outside.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("answers a company in a team the user isn't a member of like one that doesn't exist for a grant for one team too", async () => {
    const answers = await Promise.all(
      [
        [`/companies/${OUTSIDE_COMPANY_ID}`, "/companies/cmp_unknown"],
        [`/documents/${OUTSIDE_COMPANY_ID}`, "/documents/cmp_unknown"],
      ].map(async (paths) =>
        Promise.all(
          paths.map(async (path) => {
            const response = await app.request(path, {
              headers: { Authorization: `Bearer ${singleTeamAccessToken}` },
            });

            return [response.status, await response.json(), response.headers.get("WWW-Authenticate")];
          })
        )
      )
    );
    answers.forEach(([outside, unknown]) => {
      expect(outside).toEqual(unknown);
    });
  });

  it("doesn't reach a company outside the grant on the company routes either", async () => {
    expect((await call(`/companies/${UNGRANTED_COMPANY_ID}`)).status).toBe(403);
    expect((await call(`/companies/${OUTSIDE_COMPANY_ID}`)).status).toBe(404);
  });

  it("doesn't ask for a permission no app can be granted", async () => {
    const response = await call(`/${TEAM_ID}/webhooks`);
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).not.toContain("error=");
  });

  it("tells a client its token isn't valid on company routes, forged or malformed", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "RS256", typ: "at+jwt" }).sign(privateKey);
    const responses = await Promise.all(
      [forged, "not-a-token"].map((token) => app.request(`/documents/${COMPANY_ID}`, { headers: { Authorization: `Bearer ${token}` } }))
    );
    expect(responses.map(({ status }) => status)).toEqual([401, 401]);
    responses.forEach((response) => expect(response.headers.get("WWW-Authenticate")).toContain('error="invalid_token"'));
  });
});
