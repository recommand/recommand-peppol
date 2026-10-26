import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// The link of a finished verification session leads on to the company's
// verification as it stands, so that whoever opens an old link from their inbox is
// not stopped at an outcome that no longer matters. Against a real PostgreSQL,
// because which session is current is decided by the rows that were written.

const TEAM = "team_follow_up";
const COMPANY = "c_follow_up";

let pool: Pool;
let data: typeof import("../../data/company-verification");
let companies: typeof import("../../data/companies");

async function sessions() {
  const { rows } = await pool.query(
    `SELECT id, status FROM company_verification_log WHERE company_id = $1 ORDER BY created_at, id`,
    [COMPANY]
  );
  return rows as { id: string; status: string }[];
}

async function addSession(id: string, status: string, options: { minutesAgo: number; withdrawn?: boolean }) {
  await pool.query(
    `INSERT INTO company_verification_log (id, company_id, status, company_name, enterprise_number, address, postal_code, city, country, withdrawal, created_at)
     VALUES ($1, $2, $3, 'Example BV', '0123456749', 'Straat 1', '9000', 'Gent', 'BE', $4, now() - make_interval(mins => $5))`,
    [
      id,
      COMPANY,
      status,
      options.withdrawn
        ? JSON.stringify({ withdrawnAt: new Date().toISOString(), inFavorOf: "cvl_other", byUserId: "support", reason: "unused link" })
        : null,
      options.minutesAgo,
    ]
  );
}

async function followUpOf(id: string) {
  const log = await data.getCompanyVerificationLog(id);
  const company = await companies.getCompanyById(COMPANY);
  return await data.getVerificationFollowUp(log!, company!);
}

describe.skipIf(!testDatabaseUrl)("leading on from the link of a finished verification session", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    process.env.BASE_URL = "https://app.example";
    data = await import("../../data/company-verification");
    companies = await import("../../data/companies");
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
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_follow_up', $1, '0208', '0123456749')`,
      [COMPANY]
    );
  });

  it("leads an old rejected link on to the newer session still open", async () => {
    await addSession("cvl_old", "rejected", { minutesAgo: 60 });
    await addSession("cvl_open", "idVerificationRequested", { minutesAgo: 10 });

    expect(await followUpOf("cvl_old")).toBe("continue");
    const result = await data.continueVerificationFromSession("cvl_old");
    expect(result).toMatchObject({ created: false, log: { id: "cvl_open" } });
    expect(result.verificationUrl).toBe("https://app.example/company-verification/cvl_open/verify");
    expect(await sessions()).toHaveLength(2);
  });

  it("starts a new session from the company's rejected current session", async () => {
    await addSession("cvl_rejected", "rejected", { minutesAgo: 10 });

    expect(await followUpOf("cvl_rejected")).toBe("retry");
    const result = await data.continueVerificationFromSession("cvl_rejected");
    expect(result.created).toBe(true);
    expect(await sessions()).toEqual([
      { id: "cvl_rejected", status: "rejected" },
      { id: result.log.id, status: "opened" },
    ]);
    // A second click continues the session the first one started.
    expect(await data.continueVerificationFromSession("cvl_rejected")).toMatchObject({ created: false, log: { id: result.log.id } });
  });

  it("says the company is verified when a later session verified it", async () => {
    await addSession("cvl_old", "rejected", { minutesAgo: 60 });
    await addSession("cvl_verified", "verified", { minutesAgo: 10 });
    await pool.query(`UPDATE peppol_companies SET is_verified = true WHERE id = $1`, [COMPANY]);

    expect(await followUpOf("cvl_old")).toBe("companyVerified");
    expect(await followUpOf("cvl_verified")).toBeNull();
    await expect(data.continueVerificationFromSession("cvl_old")).rejects.toThrow("This verification cannot be continued.");
    expect(await sessions()).toHaveLength(2);
  });

  it("leaves an activation error of the current session to support", async () => {
    await addSession("cvl_old_error", "error", { minutesAgo: 60 });
    await addSession("cvl_error", "error", { minutesAgo: 10 });

    expect(await followUpOf("cvl_error")).toBeNull();
    expect(await followUpOf("cvl_old_error")).toBe("startNew");
    await expect(data.continueVerificationFromSession("cvl_error")).rejects.toThrow("This verification cannot be continued.");
  });

  it("leads nowhere from an open or a withdrawn session", async () => {
    await addSession("cvl_withdrawn", "rejected", { minutesAgo: 10, withdrawn: true });
    await addSession("cvl_open", "opened", { minutesAgo: 60 });

    expect(await followUpOf("cvl_withdrawn")).toBeNull();
    expect(await followUpOf("cvl_open")).toBeNull();
    await expect(data.continueVerificationFromSession("cvl_withdrawn")).rejects.toThrow("This verification cannot be continued.");
    await expect(data.continueVerificationFromSession("cvl_open")).rejects.toThrow("This verification cannot be continued.");
    expect(await sessions()).toHaveLength(2);
  });
});
