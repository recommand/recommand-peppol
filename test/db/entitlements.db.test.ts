import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Pool } from "pg";
import { TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// How this package enforces the commercial rights it registers. It works without
// any resolver, as a deployment without commercial administration does, follows
// a registered resolver without asking why, never restricts a playground, and
// refuses rather than grants when the resolver fails.

let pool: Pool;
let app: Hono;
let entitlements: typeof import("@core/lib/entitlements");
let apps: typeof import("@recommand/lib/app");
let peppolEntitlements: typeof import("../../lib/entitlements");
let team: { id: string; name: string; isPlayground: boolean };
let decisions: Record<string, { allowed: boolean; message?: string }>;

async function call(path: string) {
  const response = await app.request(path);
  return { status: response.status, text: await response.text() };
}

const registerResolver = () =>
  entitlements.registerEntitlementResolver({
    entitlementIds: Object.values(peppolEntitlements.PEPPOL_ENTITLEMENTS),
    resolve: async (_teamId, entitlementId) => {
      const decision = decisions[entitlementId];
      if (!decision) throw new Error("resolver unavailable");
      return decision;
    },
  });

describe.skipIf(!testDatabaseUrl)("entitlement enforcement against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    // The middleware module loads session handling, which needs a signing secret
    // to exist; no token is signed or verified here.
    process.env.JWT_SECRET ??= "entitlement-test-secret";
    entitlements = await import("@core/lib/entitlements");
    apps = await import("@recommand/lib/app");
    peppolEntitlements = await import("../../lib/entitlements");
    const { requireTransactionEntitlement, requireIntegrationAccess } = await import("../../utils/auth-middleware");

    const withTeam = createMiddleware(async (c, next) => {
      c.set("team" as never, team as never);
      await next();
    });
    app = new Hono();
    app.get("/send", withTeam, requireTransactionEntitlement() as never, (c) => c.json({ success: true }));
    app.get("/integrations", withTeam, requireIntegrationAccess() as never, (c) => c.json({ success: true }));
    app.onError((_error, c) => c.json({ success: false }, 500));

    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    team = { id: TEAM_ID, name: "Delivery tests", isPlayground: false };
    decisions = {};
    await pool.query("UPDATE peppol_team_extensions SET is_playground = false WHERE id = $1", [TEAM_ID]);
  });

  afterEach(() => {
    entitlements.clearEntitlementResolver();
    apps.setInstalledApps([]);
  });

  it("registers the rights it enforces", () => {
    const ids = entitlements.getRegisteredEntitlements().map((entitlement) => entitlement.id);
    expect(ids).toContain("peppol.transactions");
    expect(ids).toContain("peppol.integrations");
  });

  it("lets every team transact when no resolver is installed", async () => {
    expect((await call("/send")).status).toBe(200);
    expect((await call("/integrations")).status).toBe(200);
  });

  it("follows the resolver, addressing the team by name", async () => {
    registerResolver();
    decisions = {
      "peppol.transactions": { allowed: false, message: "Team {teamName} does not have a valid billing profile" },
      "peppol.integrations": { allowed: false, message: "Not in your plan" },
    };
    const send = await call("/send");
    expect(send.status).toBe(401);
    expect(send.text).toContain("Team Delivery tests does not have a valid billing profile");
    const integrations = await call("/integrations");
    expect(integrations.status).toBe(403);
    expect(integrations.text).toContain("Not in your plan");

    decisions = { "peppol.transactions": { allowed: true }, "peppol.integrations": { allowed: true } };
    expect((await call("/send")).status).toBe(200);
    expect((await call("/integrations")).status).toBe(200);
  });

  it("refuses when the resolver fails or is installed without being registered", async () => {
    registerResolver();
    expect((await call("/send")).status).toBe(500);

    entitlements.clearEntitlementResolver();
    apps.setInstalledApps([{ name: "billing", absolutePath: "/billing", entitlementResolver: true }]);
    expect((await call("/send")).status).toBe(500);
    expect((await call("/integrations")).status).toBe(500);
  });

  it("never restricts a playground, even when the resolver would", async () => {
    registerResolver();
    decisions = {
      "peppol.transactions": { allowed: false, message: "No" },
      "peppol.integrations": { allowed: false, message: "No" },
    };
    team = { ...team, isPlayground: true };
    await pool.query("UPDATE peppol_team_extensions SET is_playground = true WHERE id = $1", [TEAM_ID]);

    expect((await call("/send")).status).toBe(200);
    expect((await call("/integrations")).status).toBe(200);
    expect((await peppolEntitlements.checkPeppolEntitlementForTeamId(TEAM_ID, "peppol.integrations")).allowed).toBe(true);
  });
});
