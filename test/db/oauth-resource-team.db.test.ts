import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { exportJWK, generateKeyPair } from "jose";
import type { Pool } from "pg";
import { connectTestDatabase, seedDocument, seedTeamAndCompany, TEAM_ID, testDatabaseUrl } from "./harness";

// An OAuth grant can cover several teams. On a route that names a document, label,
// customer, supplier or webhook by its ID but no team, the request acts in the team
// that resource belongs to, as it does for a company.

const OTHER_TEAM_ID = "team_db_test_other";
// A team of the user that the grant doesn't cover
const UNGRANTED_TEAM_ID = "team_db_test_ungranted";
// A team the user isn't a member of
const OUTSIDE_TEAM_ID = "team_db_test_outside";
const previousEnvironment = { BASE_URL: process.env.BASE_URL, JWT_SECRET: process.env.JWT_SECRET, SIGNING_KEYS: process.env.SIGNING_KEYS };

let pool: Pool;
let app: Hono;
let accessToken: string;
// From a grant for one team, which acts in that team when the path names a resource it can't reach
let singleTeamAccessToken: string;

const call = (path: string, token = accessToken) => app.request(path, { headers: { Authorization: `Bearer ${token}` } });

// Per resource, a path that names one in a team the user isn't a member of and one that names nothing
const OUTSIDE_AND_UNKNOWN_PATHS = [
  ["/customers/cus_outside", "/customers/cus_unknown"],
  ["/documents/doc_outside", "/documents/doc_unknown"],
  ["/labels/lbl_outside", "/labels/lbl_unknown"],
  ["/suppliers/sup_outside", "/suppliers/sup_unknown"],
  ["/webhooks/whk_outside", "/webhooks/whk_unknown"],
];

const answerOutsideAndUnknown = (token: string) =>
  Promise.all(
    OUTSIDE_AND_UNKNOWN_PATHS.map(async (paths) =>
      Promise.all(
        paths.map(async (path) => {
          const response = await call(path, token);

          return [response.status, await response.json(), response.headers.get("WWW-Authenticate")];
        })
      )
    )
  );

describe.skipIf(!testDatabaseUrl)("OAuth grants for several teams on routes that name a resource, against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    process.env.JWT_SECRET = "oauth-resource-team-test-secret";
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
    await seedDocument(pool, { id: "doc_granted" });
    await seedDocument(pool, { id: "doc_outside" });
    await pool.query(`UPDATE peppol_transmitted_documents SET team_id = $1 WHERE id = 'doc_outside'`, [OUTSIDE_TEAM_ID]);
    // A webhook is a rule for every event with a single webhook action
    await pool.query(
      `INSERT INTO rules (id, team_id, name, enabled, event_type, condition, actions, schema_version)
       VALUES ('whk_granted', $1, 'Webhook', true, '*', null, $3, 1), ('whk_outside', $2, 'Webhook', true, '*', null, $3, 1)`,
      [TEAM_ID, OUTSIDE_TEAM_ID, JSON.stringify([{ type: "webhook", version: 1, config: { url: "https://example.com/hook" } }])]
    );
    await pool.query(
      `INSERT INTO peppol_labels (id, team_id, name, color_hex) VALUES
        ('lbl_granted', $1, 'Granted', '#000000'), ('lbl_ungranted', $2, 'Ungranted', '#000000'), ('lbl_outside', $3, 'Outside', '#000000')`,
      [TEAM_ID, UNGRANTED_TEAM_ID, OUTSIDE_TEAM_ID]
    );
    await pool.query(
      `INSERT INTO supporting_data_customers (id, team_id, external_id, name, address, city, postal_code, country)
       VALUES ('cus_granted', $1, 'customer-1', 'Customer', '1 Rue', 'Paris', '75001', 'FR'),
              ('cus_outside', $2, 'customer-2', 'Customer', '1 Rue', 'Paris', '75001', 'FR')`,
      [TEAM_ID, OUTSIDE_TEAM_ID]
    );
    await pool.query(
      `INSERT INTO supporting_data_suppliers (id, team_id, external_id, name) VALUES
        ('sup_granted', $1, 'supplier-1', 'Supplier'), ('sup_outside', $2, 'supplier-2', 'Supplier')`,
      [TEAM_ID, OUTSIDE_TEAM_ID]
    );
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ('usr_member', 'member@example.com', 'unused')`);
    await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, 'usr_member'), ($2, 'usr_member'), ($3, 'usr_member')`, [
      TEAM_ID,
      OTHER_TEAM_ID,
      UNGRANTED_TEAM_ID,
    ]);
    const permissionIds = ["exchange.customers.read", "exchange.documents.read", "exchange.labels.read", "exchange.suppliers.read"];
    await pool.query(
      `INSERT INTO user_permissions (user_id, team_id, permission_id)
       SELECT 'usr_member', team_id, permission_id FROM unnest($1::text[]) AS team_id, unnest($2::text[]) AS permission_id`,
      [[TEAM_ID, OTHER_TEAM_ID, UNGRANTED_TEAM_ID], permissionIds]
    );
    await pool.query(`INSERT INTO oauth_clients (id, kind, grant_types, redirect_uris, token_endpoint_auth_method) VALUES
      ('dcr_app', 'dynamic', '{authorization_code}', '{https://app.example.com/callback}', 'none')`);

    await import("../../lib/permissions");
    const { findClient } = await import("@core/data/oauth-clients");
    const { createGrant } = await import("@core/data/oauth-grants");
    const { issueTokens } = await import("@core/data/oauth-tokens");
    const { grant } = await createGrant({
      client: (await findClient("dcr_app"))!,
      permissionIds,
      teamIds: [TEAM_ID, OTHER_TEAM_ID],
      userId: "usr_member",
    });
    ({ accessToken } = (await issueTokens({ grantId: grant.id, resources: [], withRefreshToken: false }))!);
    const { grant: singleTeamGrant } = await createGrant({
      client: (await findClient("dcr_app"))!,
      permissionIds,
      teamIds: [TEAM_ID],
      userId: "usr_member",
    });
    ({ accessToken: singleTeamAccessToken } = (await issueTokens({
      grantId: singleTeamGrant.id,
      resources: [],
      withRefreshToken: false,
    }))!);

    const { default: customers } = await import("../../api/customers");
    const { default: documents } = await import("../../api/documents");
    const { default: labels } = await import("../../api/labels");
    const { default: suppliers } = await import("../../api/suppliers");
    const { default: webhooks } = await import("../../api/webhooks");
    app = new Hono();
    [customers, documents, labels, suppliers, webhooks].forEach((server) => {
      app.route("/", server);
    });
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

  it("acts in the team of the document, label, customer or supplier the path names", async () => {
    const statuses = await Promise.all(
      ["/documents/doc_granted", "/labels/lbl_granted", "/customers/cus_granted", "/suppliers/sup_granted"].map(
        async (path) => (await call(path)).status
      )
    );
    expect(statuses).toEqual([200, 200, 200, 200]);
  });

  it("acts in the team of the webhook the path names, then checks its permission", async () => {
    const response = await call("/webhooks/whk_granted");
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("insufficient_permission");
  });

  it("answers 404 for a document, label or webhook that doesn't exist", async () => {
    const statuses = await Promise.all(
      ["/documents/doc_unknown", "/labels/lbl_unknown", "/webhooks/rule_unknown"].map(async (path) => (await call(path)).status)
    );
    expect(statuses).toEqual([404, 404, 404]);
  });

  it("needs the team for a customer or supplier named by an external ID, which only names one within a team", async () => {
    const answers = await Promise.all(
      ["/customers/customer-1", "/suppliers/supplier-1"].map(async (path) => {
        const response = await call(path);

        return [response.status, (await response.json()).code];
      })
    );
    expect(answers).toEqual([
      [400, "team_required"],
      [400, "team_required"],
    ]);
  });

  it("asks for the team of a resource the user can add to the grant", async () => {
    const response = await call("/labels/lbl_ungranted");
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
  });

  it("answers a resource in a team the user isn't a member of like one that doesn't exist", async () => {
    const answers = await answerOutsideAndUnknown(accessToken);
    answers.forEach(([outside, unknown]) => {
      expect(outside).toEqual(unknown);
    });
    expect(answers.map(([[status]]) => status)).toEqual([400, 404, 404, 400, 404]);
  });

  it("answers it like one that doesn't exist for a grant for one team too, which acts in that team", async () => {
    const answers = await answerOutsideAndUnknown(singleTeamAccessToken);
    answers.forEach(([outside, unknown]) => {
      expect(outside).toEqual(unknown);
    });
    // The webhook routes check their permission, which no app can be granted, before the webhook
    expect(answers.map(([[status]]) => status)).toEqual([404, 404, 404, 404, 403]);
  });
});
