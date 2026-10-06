import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Hono } from "hono";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// What the public verification pages are told about a session that support withdrew
// in favour of an earlier one. It is stored as rejected so that its link can no
// longer be used, but nobody was refused, so the routes report the withdrawal and
// leave out the stored message. A session that really was rejected still reports
// why.

const TEAM = "team_withdrawal";
const COMPANY = "c_withdrawal";

let pool: Pool;
let statusApp: Hono;
let contextApp: Hono;
let submitApp: Hono;

async function seedSession(id: string, values: { status: string; errorMessage?: string | null; withdrawal?: object | null; createdAt: string }) {
  await pool.query(
    `INSERT INTO company_verification_log (id, company_id, status, error_message, withdrawal, company_name, enterprise_number, address, postal_code, city, country, created_at)
     VALUES ($1, $2, $3, $4, $5, 'Example BV', '0123456749', 'Straat 1', '9000', 'Gent', 'BE', $6)`,
    [id, COMPANY, values.status, values.errorMessage ?? null, values.withdrawal ? JSON.stringify(values.withdrawal) : null, values.createdAt]
  );
}

describe.skipIf(!testDatabaseUrl)("public verification routes for a withdrawn session", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    // The context route looks up the company's representatives for Belgian companies.
    mock.module("@peppol/data/cbe-public-search/client", () => ({
      getEnterpriseData: async () => ({ representatives: [{ firstName: "Jane", lastName: "Doe", function: "Director" }] }),
    }));
    process.env.BASE_URL = "https://app.example";
    statusApp = (await import("../../api/companies/verification/get-verification-status")).default;
    contextApp = (await import("../../api/companies/verification/get-verification-context")).default;
    submitApp = (await import("../../api/companies/verification/submit-identity-form")).default;
    await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1)`, [TEAM]);
    await pool.query(
      `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements) VALUES ($1, false, false, 'strict')`,
      [TEAM]
    );
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number_scheme, enterprise_number,
         is_smp_recipient, access_point_provider, smp_provider)
       VALUES ($1, $2, 'Example BV', 'Straat 1', '9000', 'Gent', 'BE', '0208', '0123456749', true, 'recommand-ap1', 'recommand-smp1')`,
      [COMPANY, TEAM]
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM company_verification_log");
    await seedSession("cvl_earlier", { status: "inReview", createdAt: "2026-09-01T10:00:00Z" });
    await seedSession("cvl_withdrawn", {
      status: "rejected",
      errorMessage: "Stored for support",
      withdrawal: { withdrawnAt: "2026-09-02T10:00:00Z", inFavorOf: "cvl_earlier", byUserId: "support", reason: "Unused link" },
      createdAt: "2026-09-01T10:05:00Z",
    });
    await seedSession("cvl_rejected", { status: "rejected", errorMessage: "The name does not match the identity document.", createdAt: "2026-08-01T10:00:00Z" });
  });

  const json = async (app: Hono, path: string) => (await app.request(path)).json();

  it("reports the withdrawal instead of the stored message, and nothing about the earlier session", async () => {
    const status = await json(statusApp, "/companies/verification/cvl_withdrawn/status");
    expect(status).toMatchObject({ success: true, status: "rejected", withdrawn: true, errorMessage: null, companyName: "Example BV" });
    const context = await json(contextApp, "/companies/verification/cvl_withdrawn/context");
    expect(context.verificationLog).toEqual({ id: "cvl_withdrawn", status: "rejected", withdrawn: true, companyName: "Example BV", errorMessage: null });
    expect(JSON.stringify([status, context])).not.toContain("cvl_earlier");
  });

  it("still reports why a session that was really rejected was rejected", async () => {
    expect(await json(statusApp, "/companies/verification/cvl_rejected/status")).toMatchObject({
      status: "rejected", withdrawn: false, errorMessage: "The name does not match the identity document.",
    });
    expect((await json(contextApp, "/companies/verification/cvl_rejected/context")).verificationLog).toMatchObject({
      withdrawn: false, errorMessage: "The name does not match the identity document.",
    });
    expect(await json(statusApp, "/companies/verification/cvl_earlier/status")).toMatchObject({ status: "inReview", withdrawn: false });
  });

  it("refuses an identity submission on the withdrawn link", async () => {
    const response = await submitApp.request("/companies/verification/cvl_withdrawn/submit-identity-form", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Jane", lastName: "Doe", mandateAccepted: false }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("already been submitted");
    const { rows } = await pool.query(`SELECT status, first_name FROM company_verification_log WHERE id = 'cvl_withdrawn'`);
    expect(rows[0]).toEqual({ status: "rejected", first_name: null });
  });
});
