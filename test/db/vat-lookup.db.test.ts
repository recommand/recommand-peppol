import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Pool } from "pg";
import type { ActivatedIntegration } from "../../data/integrations";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// The company lookup without a team, as its callers reach it: an integration token has no user,
// an API key has one. A lookup outside Belgium is refused before the register is called, so the
// answer shows the request got past authentication without depending on the register.

let pool: Pool;
let app: Hono;
let apiKey: string;
let expiredIntegrationToken: string;
let integrationToken: string;

const previousSigningKeys = process.env.SIGNING_KEYS;

const lookUp = async (authorization?: string) => {
  const response = await app.request("/vat-lookup?country=NL&vatNumber=NL123456789B01", {
    headers: authorization ? { Authorization: authorization } : {},
  });

  return { body: await response.json(), status: response.status };
};

const PAST_AUTHENTICATION = {
  body: { errors: { root: ["Company lookup is only available for Belgian companies"] }, success: false },
  status: 400,
};

describe.skipIf(!testDatabaseUrl)("looking a company up without a team against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    process.env.JWT_SECRET ??= "vat-lookup-test-secret";
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    process.env.SIGNING_KEYS = JSON.stringify({ keys: [await exportJWK(privateKey)] });

    await seedTeamAndCompany(pool);
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ('usr_lookup', 'lookup@example.com', 'unused')`);
    await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, 'usr_lookup')`, [TEAM_ID]);
    await pool.query(
      `INSERT INTO api_keys (id, name, team_id, user_id, secret_hash) VALUES ('key_lookup', 'Lookup', $1, 'usr_lookup', $2)`,
      [TEAM_ID, await Bun.password.hash("secret", { algorithm: "bcrypt", cost: 4 })]
    );
    apiKey = `Basic ${Buffer.from("key_lookup:secret").toString("base64")}`;

    const { generateIntegrationJwt } = await import("../../data/integrations/auth");
    integrationToken = `Bearer ${await generateIntegrationJwt({
      companyId: COMPANY_ID,
      id: "integration_lookup",
      manifest: { url: "https://integration.example.com" },
      teamId: TEAM_ID,
    } as ActivatedIntegration)}`;

    // The same token an integration gets, but issued two hours ago and expired an hour ago
    const { getSigningKey } = await import("@core/lib/signing-keys");
    const { key, kid } = await getSigningKey();
    const now = Math.floor(Date.now() / 1000);
    expiredIntegrationToken = `Bearer ${await new SignJWT({
      companyId: COMPANY_ID,
      integrationId: "integration_lookup",
      teamId: TEAM_ID,
    })
      .setAudience(["https://app.recommand.eu", "https://integration.example.com"])
      .setExpirationTime(now - 60 * 60)
      .setIssuedAt(now - 2 * 60 * 60)
      .setIssuer("https://app.recommand.eu")
      .setProtectedHeader({ alg: "RS256", kid })
      .sign(key)}`;

    const { default: vatLookup } = await import("../../api/companies/vat-lookup");
    app = new Hono();
    app.route("/", vatLookup as never);
  }, 60_000);

  afterAll(async () => {
    if (previousSigningKeys === undefined) {
      delete process.env.SIGNING_KEYS;
    } else {
      process.env.SIGNING_KEYS = previousSigningKeys;
    }

    await pool?.end();
  });

  it("lets an integration token through, although it has no user", async () => {
    expect(await lookUp(integrationToken)).toEqual(PAST_AUTHENTICATION);
  });

  it("lets an API key through", async () => {
    expect(await lookUp(apiKey)).toEqual(PAST_AUTHENTICATION);
  });

  it("refuses an expired integration token", async () => {
    expect((await lookUp(expiredIntegrationToken)).status).toBe(401);
  });

  it("refuses a request without credentials", async () => {
    expect((await lookUp()).status).toBe(401);
  });
});
