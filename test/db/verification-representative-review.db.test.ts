import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A Norwegian verification whose representative passed the identity check but whose
// signing authority the register leaves open is held under review for support, with
// the reason on the session. Support is told once per reason, however often the
// identity provider reports the same result.

const TEAM = "team_review";
const COMPANY = "c_review";
const SESSION = "cvl_review";
const FINDING = "They may only sign jointly with others (Styret i fellesskap).";

let pool: Pool;
let holdVerificationForRepresentativeReview: typeof import("../../data/company-verification").holdVerificationForRepresentativeReview;
let getCompanyVerificationLog: typeof import("../../data/company-verification").getCompanyVerificationLog;
let getCompanyById: typeof import("../../data/companies").getCompanyById;

async function session() {
  const { rows } = await pool.query(
    "SELECT status, error_message AS \"errorMessage\", verification_proof_reference AS \"proof\" FROM company_verification_log WHERE id = $1",
    [SESSION]
  );
  return rows[0];
}

describe.skipIf(!testDatabaseUrl)("holding a verification for a review of the representative", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    ({ holdVerificationForRepresentativeReview, getCompanyVerificationLog } = await import("../../data/company-verification"));
    ({ getCompanyById } = await import("../../data/companies"));
    await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1)`, [TEAM]);
    await pool.query(
      `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements) VALUES ($1, false, false, 'strict')`,
      [TEAM]
    );
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number_scheme, enterprise_number,
         is_smp_recipient, access_point_provider, smp_provider)
       VALUES ($1, $2, 'Nordlys Handel AS', 'Gate 1', '0150', 'Oslo', 'NO', '0192', '923609016', true, 'recommand-ap1', 'recommand-smp1')`,
      [COMPANY, TEAM]
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM company_verification_log");
    await pool.query(
      `INSERT INTO company_verification_log (id, company_id, status, first_name, last_name, company_name, enterprise_number, address, postal_code, city, country)
       VALUES ($1, $2, 'idVerificationRequested', 'Ola', 'Hansen', 'Nordlys Handel AS', '923609016', 'Gate 1', '0150', 'Oslo', 'NO')`,
      [SESSION, COMPANY]
    );
  });

  async function hold(finding: string | null, notified: string[]) {
    const log = (await getCompanyVerificationLog(SESSION))!;
    const company = (await getCompanyById(COMPANY))!;
    return holdVerificationForRepresentativeReview(
      { log, company, verificationProofReference: "didit_session_1" },
      {
        findReview: async (_company, name) => {
          expect(name).toEqual({ firstName: "Ola", lastName: "Hansen" });
          return finding;
        },
        notifySupport: async (review) => {
          notified.push(`${review.sessionId}: ${review.finding}`);
        },
      }
    );
  }

  it("puts the session under review with the reason and the identity check's reference, and tells support", async () => {
    const notified: string[] = [];
    expect(await hold(FINDING, notified)).toBe(true);
    expect(await session()).toEqual({ status: "inReview", errorMessage: FINDING, proof: "didit_session_1" });
    expect(notified).toEqual([`${SESSION}: ${FINDING}`]);
  });

  it("tells support only once when the identity provider reports the same result again", async () => {
    const notified: string[] = [];
    await hold(FINDING, notified);
    expect(await hold(FINDING, notified)).toBe(true);
    expect(notified).toHaveLength(1);
  });

  it("tells support again when the reason changes", async () => {
    const notified: string[] = [];
    await hold(FINDING, notified);
    await hold("Enhetsregisteret could not be reached to check their signing authority.", notified);
    expect(notified).toHaveLength(2);
  });

  it("leaves the session alone when the register confirms the representative", async () => {
    const notified: string[] = [];
    expect(await hold(null, notified)).toBe(false);
    expect(await session()).toEqual({ status: "idVerificationRequested", errorMessage: null, proof: null });
    expect(notified).toEqual([]);
  });
});
