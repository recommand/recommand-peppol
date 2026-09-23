import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A company's country decides its providers and default identifiers, so changing
// it rewrites three tables at once. What a country change leaves behind, and what
// it must refuse to touch, is asserted against a real PostgreSQL: the company row,
// its identifiers and the verification session it was created with either all move
// or none do.

const smpCalls: string[] = [];
let pool: Pool;
let updateCompany: typeof import("../../data/companies").updateCompany;
let createCompanyIdentifier: typeof import("../../data/company-identifiers").createCompanyIdentifier;
let createCompanyVerificationLog: typeof import("../../data/company-verification").createCompanyVerificationLog;

const TEAM_STRICT = "team_strict";
const TEAM_LAX = "team_lax";

async function seedTeam(id: string, verificationRequirements: "strict" | "lax") {
  await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [id]);
  await pool.query(
    `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements)
     VALUES ($1, false, false, $2) ON CONFLICT (id) DO NOTHING`,
    [id, verificationRequirements]
  );
}

async function seedBelgianCompany(id: string, teamId: string, options: { isVerified?: boolean } = {}) {
  await pool.query(
    `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number_scheme, enterprise_number, vat_number,
       is_smp_recipient, is_verified, access_point_provider, smp_provider)
     VALUES ($1, $2, 'Example BV', 'Straat 1', '9000', 'Gent', 'BE', '0208', '0123456749', 'BE0123456749', true, $3, 'recommand-ap1', 'recommand-smp1')`,
    [id, teamId, options.isVerified ?? false]
  );
  await pool.query(
    `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ($1 || '_en', $1, '0208', '0123456749'), ($1 || '_vat', $1, '9925', 'be0123456749')`,
    [id]
  );
  await pool.query(
    `INSERT INTO company_verification_log (id, company_id, company_name, enterprise_number, address, postal_code, city, country)
     VALUES ($1, $2, 'Example BV', '0123456749', 'Straat 1', '9000', 'Gent', 'BE')`,
    [`cvl_${id}`, id]
  );
}

async function companyRow(id: string) {
  const { rows } = await pool.query(
    `SELECT country, enterprise_number AS "enterpriseNumber", enterprise_number_scheme AS "enterpriseNumberScheme", vat_number AS "vatNumber",
            access_point_provider AS "accessPointProvider", smp_provider AS "smpProvider"
     FROM peppol_companies WHERE id = $1`,
    [id]
  );
  return rows[0];
}

async function identifierRows(id: string) {
  const { rows } = await pool.query(
    `SELECT scheme || ':' || identifier AS address FROM peppol_company_identifiers WHERE company_id = $1 ORDER BY scheme`,
    [id]
  );
  return rows.map((row) => row.address as string);
}

async function sessionRow(id: string) {
  const { rows } = await pool.query(
    `SELECT status, country, enterprise_number AS "enterpriseNumber", city FROM company_verification_log WHERE id = $1`,
    [id]
  );
  return rows[0];
}

describe.skipIf(!testDatabaseUrl)("company country changes against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/data/smp-providers", () => ({
      upsertCompanyRegistrations: async () => { smpCalls.push("upsert"); },
      unregisterCompanyRegistrations: async () => { smpCalls.push("unregister"); },
      upsertCompanyRegistration: async () => { smpCalls.push("upsert-one"); },
      unregisterCompanyIdentifier: async () => { smpCalls.push("unregister-one"); },
      unregisterCompanyDocumentType: async () => { smpCalls.push("unregister-doctype"); },
    }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: async () => {} }));
    process.env.BASE_URL = "https://app.example";
    ({ updateCompany } = await import("../../data/companies"));
    ({ createCompanyIdentifier } = await import("../../data/company-identifiers"));
    ({ createCompanyVerificationLog } = await import("../../data/company-verification"));
    await seedTeam(TEAM_STRICT, "strict");
    await seedTeam(TEAM_LAX, "lax");
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    smpCalls.length = 0;
    await pool.query("TRUNCATE peppol_companies CASCADE");
  });

  const originalBelgian = {
    country: "BE", enterpriseNumber: "0123456749", enterpriseNumberScheme: "0208", vatNumber: "BE0123456749",
    accessPointProvider: "recommand-ap1", smpProvider: "recommand-smp1",
  };

  it("moves an untouched Belgian company to France with its providers, identifiers and open session", async () => {
    await seedBelgianCompany("c_move", TEAM_STRICT);
    const updated = await updateCompany({
      id: "c_move", teamId: TEAM_STRICT, country: "FR", enterpriseNumber: "303265045", vatNumber: null, city: "Paris",
    });
    expect(updated.country).toBe("FR");
    expect(await companyRow("c_move")).toEqual({
      country: "FR", enterpriseNumber: "303265045", enterpriseNumberScheme: "0225", vatNumber: null,
      accessPointProvider: "at-shared-ap-fr", smpProvider: "at-shared-smp-fr",
    });
    expect(await identifierRows("c_move")).toEqual(["0225:303265045"]);
    // The enterprise number changed with the country, which revokes the open link
    // as any enterprise number change does; the revoked empty session does not
    // count as a started verification.
    expect(await sessionRow("cvl_c_move")).toMatchObject({ status: "rejected", country: "FR", enterpriseNumber: "303265045", city: "Paris" });
    expect(smpCalls).toEqual([]);
    await updateCompany({ id: "c_move", teamId: TEAM_STRICT, country: "BE", enterpriseNumber: "0123456749", vatNumber: "BE0123456749" });
    expect(await companyRow("c_move")).toMatchObject({ country: "BE", smpProvider: "recommand-smp1" });
  });

  it("keeps an open link valid when the country changes without the numbers", async () => {
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, is_smp_recipient, access_point_provider, smp_provider)
       VALUES ('c_plain', $1, 'Example GmbH', 'Strasse 1', '10115', 'Berlin', 'DE', true, 'recommand-ap1', 'recommand-smp1')`,
      [TEAM_STRICT]
    );
    await pool.query(
      `INSERT INTO company_verification_log (id, company_id, company_name, address, postal_code, city, country)
       VALUES ('cvl_c_plain', 'c_plain', 'Example GmbH', 'Strasse 1', '10115', 'Berlin', 'DE')`
    );
    await updateCompany({ id: "c_plain", teamId: TEAM_STRICT, country: "AT", city: "Wien" });
    expect(await sessionRow("cvl_c_plain")).toEqual({ status: "opened", country: "AT", enterpriseNumber: null, city: "Wien" });
    expect(await identifierRows("c_plain")).toEqual([]);
  });

  it("moves a French company back with the Belgian defaults", async () => {
    await seedBelgianCompany("c_back", TEAM_STRICT);
    await updateCompany({ id: "c_back", teamId: TEAM_STRICT, country: "FR", enterpriseNumber: "303265045", vatNumber: null });
    await updateCompany({ id: "c_back", teamId: TEAM_STRICT, country: "BE", enterpriseNumber: "0123456749", vatNumber: "BE0123456749" });
    expect(await companyRow("c_back")).toMatchObject({
      country: "BE", enterpriseNumberScheme: "0208", accessPointProvider: "recommand-ap1", smpProvider: "recommand-smp1",
    });
    expect(await identifierRows("c_back")).toEqual(["0208:0123456749", "9925:be0123456749"]);
  });

  it("refuses the move once a verification went past the empty session", async () => {
    await seedBelgianCompany("c_started", TEAM_STRICT);
    await pool.query(`UPDATE company_verification_log SET status = 'idVerificationRequested', first_name = 'A', last_name = 'B' WHERE id = 'cvl_c_started'`);
    await expect(updateCompany({
      id: "c_started", teamId: TEAM_STRICT, country: "FR", enterpriseNumber: "303265045", vatNumber: null,
    })).rejects.toThrow("cannot be changed once its verification has started");
    expect(await companyRow("c_started")).toMatchObject({ country: "BE", smpProvider: "recommand-smp1", enterpriseNumber: "0123456749" });
    expect(await identifierRows("c_started")).toEqual(["0208:0123456749", "9925:be0123456749"]);
  });

  it("refuses the move for a company that is on the SMP", async () => {
    await seedBelgianCompany("c_registered", TEAM_LAX);
    await expect(updateCompany({
      id: "c_registered", teamId: TEAM_LAX, country: "FR", enterpriseNumber: "303265045", vatNumber: null,
    })).rejects.toThrow("registered on the Peppol network");
    expect(await identifierRows("c_registered")).toEqual(["0208:0123456749", "9925:be0123456749"]);
    expect(smpCalls).toEqual([]);
  });

  it("still lets the other fields of such a company change", async () => {
    await seedBelgianCompany("c_fields", TEAM_LAX);
    const updated = await updateCompany({ id: "c_fields", teamId: TEAM_LAX, name: "Renamed BV" });
    expect(updated.name).toBe("Renamed BV");
    expect(updated.country).toBe("BE");
  });

  it("refuses the move while an added identifier would not be registered in the new country", async () => {
    await seedBelgianCompany("c_extra", TEAM_STRICT);
    await pool.query(`INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_extra', 'c_extra', '0009', '30326504500011')`);
    await expect(updateCompany({
      id: "c_extra", teamId: TEAM_STRICT, country: "FR", enterpriseNumber: "303265045", vatNumber: null,
    })).rejects.toThrow("Remove 0009:30326504500011");
    expect(await companyRow("c_extra")).toMatchObject({ country: "BE" });
    expect(await identifierRows("c_extra")).toEqual(["0009:30326504500011", "0208:0123456749", "9925:be0123456749"]);
  });

  it("leaves nothing half moved when an identifier write fails", async () => {
    await seedBelgianCompany("c_atomic", TEAM_STRICT);
    await pool.query(`
      CREATE FUNCTION refuse_identifier_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'identifier storage unavailable'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER refuse_identifier_insert BEFORE INSERT ON peppol_company_identifiers
        FOR EACH ROW EXECUTE FUNCTION refuse_identifier_insert();
    `);
    try {
      await expect(updateCompany({
        id: "c_atomic", teamId: TEAM_STRICT, country: "FR", enterpriseNumber: "303265045", vatNumber: null,
      })).rejects.toThrow();
    } finally {
      await pool.query("DROP TRIGGER refuse_identifier_insert ON peppol_company_identifiers; DROP FUNCTION refuse_identifier_insert()");
    }
    expect(await companyRow("c_atomic")).toMatchObject({ country: "BE", smpProvider: "recommand-smp1", enterpriseNumber: "0123456749" });
    expect(await identifierRows("c_atomic")).toEqual(["0208:0123456749", "9925:be0123456749"]);
    expect(await sessionRow("cvl_c_atomic")).toMatchObject({ country: "BE", status: "opened" });
  });

  it("writes nothing when a new default address is already held by another recipient", async () => {
    await seedBelgianCompany("c_clash", TEAM_STRICT);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number, is_smp_recipient, access_point_provider, smp_provider)
       VALUES ('c_holder', $1, 'Holder SARL', '1 Rue', '75001', 'Paris', 'FR', '303265045', true, 'at-shared-ap-fr', 'at-shared-smp-fr')`,
      [TEAM_LAX]
    );
    await pool.query(`INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_holder', 'c_holder', '0225', '303265045')`);
    await expect(updateCompany({
      id: "c_clash", teamId: TEAM_STRICT, country: "FR", enterpriseNumber: "303265045", vatNumber: null, city: "Paris",
    })).rejects.toThrow("already registered as recipient with another company");
    expect(await companyRow("c_clash")).toEqual(originalBelgian);
    expect(await identifierRows("c_clash")).toEqual(["0208:0123456749", "9925:be0123456749"]);
    expect(await sessionRow("cvl_c_clash")).toEqual({ status: "opened", country: "BE", enterpriseNumber: "0123456749", city: "Gent" });
    expect(smpCalls).toEqual([]);
  });

  it("refuses the move when the company was registered between reading it and locking it", async () => {
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number, vat_number, is_smp_recipient, access_point_provider, smp_provider)
       VALUES ('c_stale', $1, 'Example BV', 'Straat 1', '9000', 'Gent', 'BE', '0123456749', 'BE0123456749', false, 'recommand-ap1', 'recommand-smp1')`,
      [TEAM_LAX]
    );
    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT id FROM peppol_companies WHERE id = 'c_stale' FOR UPDATE");
      let settled = false;
      const move = updateCompany({ id: "c_stale", teamId: TEAM_LAX, country: "FR", enterpriseNumber: "303265045", vatNumber: null })
        .finally(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      // An ordinary update registered the company as recipient in the meantime.
      await other.query("UPDATE peppol_companies SET is_smp_recipient = true WHERE id = 'c_stale'");
      await other.query("COMMIT");
      await expect(move).rejects.toThrow("changed while it was being updated");
    } finally {
      other.release();
    }
    expect(await companyRow("c_stale")).toMatchObject({ country: "BE", smpProvider: "recommand-smp1" });
    expect(smpCalls).toEqual([]);
  });

  it("refuses to move the country and publish a registration in one request", async () => {
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number, vat_number, is_smp_recipient, access_point_provider, smp_provider)
       VALUES ('c_sendonly', $1, 'Example BV', 'Straat 1', '9000', 'Gent', 'BE', '0123456749', 'BE0123456749', false, 'recommand-ap1', 'recommand-smp1')`,
      [TEAM_LAX]
    );
    await expect(updateCompany({
      id: "c_sendonly", teamId: TEAM_LAX, country: "FR", enterpriseNumber: "303265045", vatNumber: null, isSmpRecipient: true,
    })).rejects.toThrow("Change the country first");
    expect(await companyRow("c_sendonly")).toMatchObject({ country: "BE", smpProvider: "recommand-smp1" });
    expect(smpCalls).toEqual([]);
    await updateCompany({ id: "c_sendonly", teamId: TEAM_LAX, country: "FR", enterpriseNumber: "303265045", vatNumber: null });
    await updateCompany({ id: "c_sendonly", teamId: TEAM_LAX, isSmpRecipient: true });
    expect(smpCalls).toEqual(["upsert"]);
    expect(await companyRow("c_sendonly")).toMatchObject({ country: "FR", smpProvider: "at-shared-smp-fr" });
  });

  it("waits for a submission holding the company and then refuses the move", async () => {
    await seedBelgianCompany("c_race", TEAM_STRICT);
    const submitter = await pool.connect();
    try {
      await submitter.query("BEGIN");
      await submitter.query("SELECT id FROM peppol_companies WHERE id = 'c_race' FOR SHARE");
      await submitter.query("UPDATE company_verification_log SET status = 'idVerificationRequested', first_name = 'A', last_name = 'B' WHERE id = 'cvl_c_race'");
      let settled = false;
      const move = updateCompany({ id: "c_race", teamId: TEAM_STRICT, country: "FR", enterpriseNumber: "303265045", vatNumber: null })
        .finally(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await submitter.query("COMMIT");
      await expect(move).rejects.toThrow("cannot be changed once its verification has started");
    } finally {
      submitter.release();
    }
    expect(await companyRow("c_race")).toEqual(originalBelgian);
  });

  it("refuses an identifier write that was validated against the company before it moved", async () => {
    await seedBelgianCompany("c_ident", TEAM_STRICT);
    const mover = await pool.connect();
    try {
      await mover.query("BEGIN");
      await mover.query("SELECT id FROM peppol_companies WHERE id = 'c_ident' FOR UPDATE");
      let settled = false;
      // Validated as a Belgian GLN while the row is held; the write has to wait.
      const write = createCompanyIdentifier({
        companyIdentifier: { companyId: "c_ident", scheme: "0088", identifier: "5410000000012" }, skipSmpRegistration: true, useTestNetwork: false,
      }).finally(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await mover.query(`UPDATE peppol_companies SET country = 'FR', enterprise_number = '303265045', vat_number = null,
        access_point_provider = 'at-shared-ap-fr', smp_provider = 'at-shared-smp-fr' WHERE id = 'c_ident'`);
      await mover.query("COMMIT");
      await expect(write).rejects.toThrow("company changed while the identifier was being saved");
    } finally {
      mover.release();
    }
    expect(await identifierRows("c_ident")).toEqual(["0208:0123456749", "9925:be0123456749"]);
  });

  it("refuses a verification link while the company holds identifiers its SMP would not register", async () => {
    await seedBelgianCompany("c_link", TEAM_STRICT);
    await updateCompany({ id: "c_link", teamId: TEAM_STRICT, country: "FR", enterpriseNumber: "303265045", vatNumber: null });
    // Data as it stands for companies created before the scheme policy existed.
    await pool.query(`INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_siren', 'c_link', '0002', '303265045'), ('ci_siret', 'c_link', '0009', '30326504500011')`);
    await expect(createCompanyVerificationLog({ teamId: TEAM_STRICT, companyId: "c_link" })).rejects.toThrow("Remove or change 0002:303265045, 0009:30326504500011");
    await pool.query(`DELETE FROM peppol_company_identifiers WHERE company_id = 'c_link' AND scheme <> '0225'`);
    const { log } = await createCompanyVerificationLog({ teamId: TEAM_STRICT, companyId: "c_link" });
    expect(log.country).toBe("FR");
  });
});
