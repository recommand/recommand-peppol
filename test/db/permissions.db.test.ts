import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Pool } from "pg";
import { TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// What a Peppol route requires of a credential: an API key needs the route's
// permission, and an integration token, which carries no user to hold one, keeps
// the access it had. The migration gives every existing member and key the
// permissions of the routes they could already use.

const MIGRATION = new URL("../../db/drizzle/20261109001828_grant_permissions_on_existing_routes.sql", import.meta.url);

let pool: Pool;
let app: Hono;
let integrationPrivateKey: CryptoKey;

const basic = (id: string, secret: string) => ({ Authorization: `Basic ${btoa(`${id}:${secret}`)}` });

const integrationToken = async (teamId: string) => {
  return new SignJWT({ companyId: "cmp_db_test", integrationId: "int_test", teamId })
    .setProtectedHeader({ alg: "RS256" })
    .setAudience("https://app.recommand.eu")
    .setExpirationTime("5m")
    .sign(integrationPrivateKey);
};

const seedKey = async (id: string, permissionIds: string[]) => {
  const secretHash = await Bun.password.hash(`secret_${id}`, { algorithm: "bcrypt", cost: 4 });
  await pool.query(
    `INSERT INTO api_keys (id, name, user_id, team_id, type, secret_hash) VALUES ($1, $1, 'usr_owner', $2, 'basic', $3)`,
    [id, TEAM_ID, secretHash]
  );
  await pool.query(
    `INSERT INTO principal_permissions (principal_type, principal_id, team_id, permission_id)
     SELECT 'api_key', $1, $2, unnest($3::text[])`,
    [id, TEAM_ID, permissionIds]
  );
};

describe.skipIf(!testDatabaseUrl)("permissions on Peppol routes against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    process.env.JWT_SECRET ??= "permissions-test-secret";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    integrationPrivateKey = privateKey;
    process.env.INTEGRATIONS_JWKS = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256" }] });

    await import("../../lib/permissions");
    const { requireIntegrationSupportedTeamAccess, requirePermission } = await import("../../utils/auth-middleware");
    app = new Hono();
    app.get(
      "/:teamId/companies",
      requireIntegrationSupportedTeamAccess() as never,
      requirePermission("exchange.companies.read") as never,
      (c) => c.json({ success: true })
    );
    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE users, api_keys, principal_permissions, user_permissions CASCADE");
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ('usr_owner', 'owner@example.com', 'unused')`);
    await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, 'usr_owner')`, [TEAM_ID]);
    await pool.query(
      `INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES ('usr_owner', $1, 'exchange.companies.read')`,
      [TEAM_ID]
    );
  });

  it("lets a key with the route's permission through", async () => {
    await seedKey("key_read", ["exchange.companies.read"]);
    const response = await app.request(`/${TEAM_ID}/companies`, { headers: basic("key_read", "secret_key_read") });
    expect(response.status).toBe(200);
  });

  it("refuses a key without it, naming the permission", async () => {
    await seedKey("key_none", []);
    const response = await app.request(`/${TEAM_ID}/companies`, { headers: basic("key_none", "secret_key_none") });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "insufficient_permission",
      errors: { root: ["This operation needs the exchange.companies.read permission."] },
      success: false,
    });
  });

  it("lets an integration token through for its own team only", async () => {
    const own = await app.request(`/${TEAM_ID}/companies`, {
      headers: { Authorization: `Bearer ${await integrationToken(TEAM_ID)}` },
    });
    expect(own.status).toBe(200);
    const other = await app.request(`/${TEAM_ID}/companies`, {
      headers: { Authorization: `Bearer ${await integrationToken("team_other")}` },
    });
    expect(other.status).toBe(401);
  });

  it("gives every existing member and key the permissions of the routes they could use", async () => {
    await pool.query("DELETE FROM user_permissions");
    await seedKey("key_existing", []);
    await pool.query(await readFile(MIGRATION, "utf-8"));

    const members = await pool.query(`SELECT permission_id FROM user_permissions WHERE user_id = 'usr_owner' ORDER BY 1`);
    const keys = await pool.query(`SELECT permission_id FROM principal_permissions WHERE principal_id = 'key_existing' ORDER BY 1`);
    const { getRegisteredPermissionsByScope } = await import("@core/lib/permissions");
    const exchangePermissions = getRegisteredPermissionsByScope("team")
      .map((permission) => permission.id)
      .filter((id) => id.startsWith("exchange."))
      .toSorted();
    expect(exchangePermissions).toHaveLength(38);
    expect(members.rows.map((row) => row.permission_id)).toEqual(exchangePermissions);
    expect(keys.rows.map((row) => row.permission_id)).toEqual(exchangePermissions);
  });
});
