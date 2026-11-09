import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Pool } from "pg";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// What a Peppol route requires of a credential: an API key needs the route's
// permission, and an integration token, which carries no user to hold one, keeps
// the access it had. The migration gives every existing member and key the
// permissions of the routes they could already use.

const MIGRATION = new URL("../../db/drizzle/20261120171500_grant_permissions_on_existing_routes.sql", import.meta.url);

let pool: Pool;
let app: Hono;
let integrationPrivateKey: CryptoKey;
const previousSigningKeys = process.env.SIGNING_KEYS;

const basic = (id: string, secret: string) => ({ Authorization: `Basic ${btoa(`${id}:${secret}`)}` });

const integrationToken = async (teamId: string) => new SignJWT({ companyId: "cmp_db_test", integrationId: "int_test", teamId })
  .setProtectedHeader({ alg: "RS256" })
  .setAudience("https://app.recommand.eu")
  .setExpirationTime("5m")
  .setIssuer("https://app.recommand.eu")
  .sign(integrationPrivateKey);

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
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    integrationPrivateKey = privateKey;
    // Integration tokens are signed with the platform's signing keys
    process.env.SIGNING_KEYS = JSON.stringify({ keys: [await exportJWK(privateKey)] });

    await import("../../lib/permissions");
    const { requireIntegrationSupportedTeamAccess, requirePermission } = await import("../../utils/auth-middleware");
    app = new Hono();
    app.get(
      "/:teamId/companies",
      requireIntegrationSupportedTeamAccess() as never,
      requirePermission("exchange.companies.read") as never,
      (c) => c.json({ success: true })
    );
    const { default: identifiers } = await import("../../api/companies/identifiers");
    app.route("/", identifiers);
    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    if (previousSigningKeys === undefined) {
      delete process.env.SIGNING_KEYS;
    } else {
      process.env.SIGNING_KEYS = previousSigningKeys;
    }

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

  it("needs `exchange.identifiers.migrate` to create an identifier with a migration key", async () => {
    await pool.query(
      `INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES ('usr_owner', $1, 'exchange.identifiers.migrate'), ('usr_owner', $1, 'exchange.identifiers.write')`,
      [TEAM_ID]
    );
    await seedKey("key_write", ["exchange.identifiers.write"]);
    const create = async (body: Record<string, string>) => app.request(`/${TEAM_ID}/companies/${COMPANY_ID}/identifiers`, {
      body: JSON.stringify(body),
      headers: { ...basic("key_write", "secret_key_write"), "Content-Type": "application/json" },
      method: "POST",
    });
    const refused = await create({ identifier: "0123456749", migrationKey: "Ab12$#xyZ9!kLm", scheme: "0208" });
    expect(refused.status).toBe(403);
    expect((await refused.json()).errors).toEqual({ root: ["This operation needs the exchange.identifiers.migrate permission."] });
    expect((await create({ identifier: "0123456749", scheme: "0208" })).status).not.toBe(403);
  });

  it("shows migration keys only to a credential that may migrate", async () => {
    await pool.query(
      `INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES ('usr_owner', $1, 'exchange.identifiers.migrate'), ('usr_owner', $1, 'exchange.identifiers.read')`,
      [TEAM_ID]
    );
    await pool.query(`DELETE FROM peppol_company_identifiers WHERE company_id = $1`, [COMPANY_ID]);
    await pool.query(`INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('cid_migrations', $1, '0208', '0123456749')`, [COMPANY_ID]);
    await pool.query(
      `INSERT INTO peppol_participant_migrations (id, company_id, scheme, identifier, direction, status, migration_key) VALUES ('pm_test', $1, '0208', '0123456749', 'outbound', 'inProgress', 'Ab12$#xyZ9!kLm')`,
      [COMPANY_ID]
    );
    await seedKey("key_read", ["exchange.identifiers.read"]);
    await seedKey("key_migrate", ["exchange.identifiers.migrate", "exchange.identifiers.read"]);
    const keys = await Promise.all(["key_read", "key_migrate"].map(async (id) => {
      const response = await app.request(`/${TEAM_ID}/companies/${COMPANY_ID}/identifiers/cid_migrations/migrations`, { headers: basic(id, `secret_${id}`) });

      return (await response.json()).migrations.map((migration: { migrationKey?: string }) => migration.migrationKey);
    }));
    expect(keys).toEqual([[undefined], ["Ab12$#xyZ9!kLm"]]);
  });

  it("gives every existing member and key the permissions of the routes they could use", async () => {
    await pool.query("DELETE FROM user_permissions");
    await seedKey("key_existing", []);
    await pool.query(await readFile(MIGRATION, "utf-8"));

    const members = await pool.query(`SELECT permission_id FROM user_permissions WHERE user_id = 'usr_owner'`);
    const keys = await pool.query(`SELECT permission_id FROM principal_permissions WHERE principal_id = 'key_existing'`);
    const { getRegisteredPermissionsByScope } = await import("@core/lib/permissions");
    const exchangePermissions = getRegisteredPermissionsByScope("team")
      .map((permission) => permission.id)
      .filter((id) => id.startsWith("exchange."))
      .toSorted();
    expect(exchangePermissions).toHaveLength(38);
    expect(members.rows.map((row) => row.permission_id).toSorted()).toEqual(exchangePermissions);
    expect(keys.rows.map((row) => row.permission_id).toSorted()).toEqual(exchangePermissions);
  });

  it("gives the keys of platform admins every permission, and can run again", async () => {
    await pool.query("DELETE FROM user_permissions");
    await pool.query(`INSERT INTO users (id, email, password_hash, is_admin) VALUES ('usr_admin', 'admin@example.com', 'unused', true)`);
    const secretHash = await Bun.password.hash("secret_key_admin", { algorithm: "bcrypt", cost: 4 });
    await pool.query(
      `INSERT INTO api_keys (id, name, user_id, team_id, type, secret_hash) VALUES ('key_admin', 'key_admin', 'usr_admin', $1, 'basic', $2)`,
      [TEAM_ID, secretHash]
    );
    const migration = await readFile(MIGRATION, "utf-8");
    await pool.query(migration);
    await pool.query(migration);

    const keys = await pool.query(`SELECT permission_id FROM principal_permissions WHERE principal_id = 'key_admin'`);
    const { getRegisteredPermissionsByScope } = await import("@core/lib/permissions");
    expect(keys.rows.map((row) => row.permission_id).toSorted()).toEqual(
      getRegisteredPermissionsByScope("team").map((permission) => permission.id).filter((id) => id.startsWith("exchange.")).toSorted()
    );
  });

  it("refuses every route with team data to a key without permissions", async () => {
    await seedKey("key_none", []);
    const { default: peppol } = await import("../../index");
    const routes = [...new Set(peppol.routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} ${route.path}`))];
    const open = await Promise.all(routes.map(async (route) => {
      const [method, path] = route.split(" ") as [string, string];
      const response = await peppol.request(path.replace(":teamId", TEAM_ID).replace(":companyId", COMPANY_ID).replace(/:\w+/g, "unknown"), {
        body: ["DELETE", "GET"].includes(method) ? undefined : "{}",
        headers: { ...basic("key_none", "secret_key_none"), "Content-Type": "application/json" },
        method,
      });
      const body = await response.json().catch(() => null);

      return body?.code === "insufficient_permission" ? null : route.replace(/ \/(peppol|v1)\//, " /");
    }));
    // Routes without team data: they serve no team, or only what the team may use
    expect([...new Set(open.filter((route) => route !== null))].toSorted()).toEqual([
      "GET /:teamId/entitlements",
      "GET /:teamId/playground",
      "GET /:teamId/team-extension",
      "GET /companies/verification/:companyVerificationLogId/context",
      "GET /companies/verification/:companyVerificationLogId/status",
      "GET /integrations/jwks",
      "GET /playgrounds/current",
      "GET /receivingCapabilities",
      "POST /companies/verification/:companyVerificationLogId/continue",
      "POST /companies/verification/:companyVerificationLogId/forward",
      "POST /companies/verification/:companyVerificationLogId/mandate-draft",
      "POST /companies/verification/:companyVerificationLogId/restart-id-verification",
      "POST /companies/verification/:companyVerificationLogId/submit-identity-form",
      "POST /companies/verification/:companyVerificationLogId/submit-playground-verification",
      "POST /internal/arratech",
      "POST /internal/didit",
      "POST /internal/postmark",
      "POST /internal/receiveDocument",
      "POST /playgrounds",
      "POST /search-peppol-directory",
      "POST /searchPeppolDirectory",
      "POST /verify",
      "POST /verify-document-support",
      "POST /verifyDocumentSupport",
    ]);
  }, 120_000);

  it("offers apps sending, notification addresses and webhooks only when the user ticks them, and never what outlives the grant", async () => {
    const { getDelegablePermission } = await import("@core/lib/permissions");
    ["exchange.documents.send", "exchange.notification_email_addresses.write", "exchange.webhooks.write"].forEach((permissionId) =>
      expect(getDelegablePermission(permissionId)?.delegation).toBe("opt_in")
    );
    ["exchange.identifiers.migrate", "exchange.integrations.read", "exchange.integrations.write", "exchange.webhooks.read"].forEach((permissionId) =>
      expect(getDelegablePermission(permissionId)).toBeNull()
    );
  });
});
