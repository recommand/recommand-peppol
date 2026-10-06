import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// Asking to verify a company again continues its open verification session rather
// than starting a blank one. A blank session would become the company's current
// session and hide one whose representative already went through the identity
// check, which can then no longer be reviewed. Against a real PostgreSQL, because
// what matters is what two requests at once leave behind.

const TEAM = "team_reuse";
const COMPANY = "c_reuse";

let pool: Pool;
let createCompanyVerificationLog: typeof import("../../data/company-verification").createCompanyVerificationLog;
let getCurrentVerificationSession: typeof import("../../data/current-verification-session").getCurrentVerificationSession;

async function sessions() {
  const { rows } = await pool.query(
    `SELECT id, status FROM company_verification_log WHERE company_id = $1 ORDER BY created_at, id`,
    [COMPANY]
  );
  return rows as { id: string; status: string }[];
}

describe.skipIf(!testDatabaseUrl)("continuing an open verification session", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    process.env.BASE_URL = "https://app.example";
    ({ createCompanyVerificationLog } = await import("../../data/company-verification"));
    ({ getCurrentVerificationSession } = await import("../../data/current-verification-session"));
    await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1)`, [TEAM]);
    await pool.query(
      `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements) VALUES ($1, false, false, 'strict')`,
      [TEAM]
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE peppol_companies CASCADE");
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number_scheme, enterprise_number,
         is_smp_recipient, access_point_provider, smp_provider)
       VALUES ($1, $2, 'Example BV', 'Straat 1', '9000', 'Gent', 'BE', '0208', '0123456749', true, 'recommand-ap1', 'recommand-smp1')`,
      [COMPANY, TEAM]
    );
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_reuse', $1, '0208', '0123456749')`,
      [COMPANY]
    );
  });

  const request = () => createCompanyVerificationLog({ teamId: TEAM, companyId: COMPANY });

  it("creates one session for requests that arrive together", async () => {
    const results = await Promise.all([request(), request(), request()]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.log.id)).size).toBe(1);
    expect(results[0].verificationUrl).toBe(`https://app.example/company-verification/${results[0].log.id}/verify`);
    expect(await sessions()).toHaveLength(1);
  });

  it("continues a session in every open state, the one under review included", async () => {
    const first = await request();
    for (const status of ["opened", "idVerificationRequested", "inReview"]) {
      await pool.query(`UPDATE company_verification_log SET status = $1 WHERE id = $2`, [status, first.log.id]);
      const again = await request();
      expect(again).toMatchObject({ created: false, log: { id: first.log.id, status } });
    }
    expect(await sessions()).toEqual([{ id: first.log.id, status: "inReview" }]);
  });

  it("starts a new session after a final one or once the company details changed", async () => {
    const first = await request();
    await pool.query(`UPDATE company_verification_log SET status = 'rejected' WHERE id = $1`, [first.log.id]);
    const afterRejection = await request();
    expect(afterRejection.created).toBe(true);

    await pool.query(`UPDATE company_verification_log SET status = 'inReview' WHERE id = $1`, [afterRejection.log.id]);
    await pool.query(`UPDATE peppol_companies SET address = 'Straat 2' WHERE id = $1`, [COMPANY]);
    const afterChange = await request();
    expect(afterChange.created).toBe(true);
    expect(afterChange.log.address).toBe("Straat 2");
    expect((await sessions()).map((row) => row.status)).toEqual(["rejected", "inReview", "opened"]);
  });

  it("passes over a withdrawn session to the one it gave way to", async () => {
    const first = await request();
    await pool.query(`UPDATE company_verification_log SET status = 'inReview' WHERE id = $1`, [first.log.id]);
    await pool.query(
      `INSERT INTO company_verification_log (id, company_id, status, company_name, enterprise_number, address, postal_code, city, country, withdrawal, created_at)
       VALUES ('cvl_withdrawn', $1, 'rejected', 'Example BV', '0123456749', 'Straat 1', '9000', 'Gent', 'BE', $2, now() + interval '1 minute')`,
      [COMPANY, JSON.stringify({ withdrawnAt: new Date().toISOString(), inFavorOf: first.log.id, byUserId: "support", reason: "unused link" })]
    );
    expect((await getCurrentVerificationSession(COMPANY))?.id).toBe(first.log.id);
    expect(await request()).toMatchObject({ created: false, log: { id: first.log.id } });
  });

  it("refuses a company of another team", async () => {
    await expect(createCompanyVerificationLog({ teamId: "team_other", companyId: COMPANY })).rejects.toThrow("Company not found");
    expect(await sessions()).toEqual([]);
  });
});
