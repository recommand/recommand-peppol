import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A Greek company's identifier under 9933 is stored as the bare AFM, and the prefixed
// form names the same identifier. Writing it again in either form, against a value
// stored with or without the prefix, must neither add a second row nor change the
// stored one.

let pool: Pool;
let createCompany: typeof import("../../data/companies").createCompany;
let createCompanyIdentifier: typeof import("../../data/company-identifiers").createCompanyIdentifier;
let updateCompanyIdentifier: typeof import("../../data/company-identifiers").updateCompanyIdentifier;

const TEAM = "team_gr";

async function identifierRows(companyId: string) {
  const { rows } = await pool.query(
    `SELECT id, scheme || ':' || identifier AS address
     FROM peppol_company_identifiers WHERE company_id = $1 ORDER BY scheme, identifier`,
    [companyId]
  );
  return rows as { id: string; address: string }[];
}

const greekCompany = {
  teamId: TEAM,
  name: "Παράδειγμα Α.Ε.",
  address: "Οδός 1",
  postalCode: "10431",
  city: "Athens",
  country: "GR" as const,
  enterpriseNumber: null,
  vatNumber: "EL094014201",
  isSmpRecipient: true,
  skipDefaultCompanySetup: false,
};

const write = { skipSmpRegistration: true, useTestNetwork: false };

describe.skipIf(!testDatabaseUrl)("Greek company identifiers against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/data/smp-providers", () => ({
      upsertCompanyRegistrations: async () => {},
      unregisterCompanyRegistrations: async () => {},
      upsertCompanyRegistration: async () => {},
      unregisterCompanyIdentifier: async () => {},
      unregisterCompanyDocumentType: async () => {},
      upsertCompanyDocumentTypeRegistration: async () => {},
    }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: async () => {} }));
    ({ createCompany } = await import("../../data/companies"));
    ({ createCompanyIdentifier, updateCompanyIdentifier } = await import("../../data/company-identifiers"));
    await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [TEAM]);
    await pool.query(
      `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements)
       VALUES ($1, true, false, 'lax') ON CONFLICT (id) DO NOTHING`,
      [TEAM]
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE peppol_companies CASCADE");
  });

  it("stores the bare AFM and refuses the same AFM again in either form", async () => {
    const company = await createCompany(greekCompany);
    await createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "9933", identifier: "EL094014201" }, ...write });
    expect((await identifierRows(company.id)).map((row) => row.address)).toEqual(["9933:094014201"]);

    for (const identifier of ["EL094014201", "094014201", "gr094014201"]) {
      await expect(
        createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "9933", identifier }, ...write })
      ).rejects.toThrow("already exists");
    }
    expect(await identifierRows(company.id)).toHaveLength(1);
  });

  it("treats a value stored with the prefix as the same identifier", async () => {
    const company = await createCompany(greekCompany);
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_legacy', $1, '9933', 'el094014201')`,
      [company.id]
    );

    await expect(
      createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "9933", identifier: "094014201" }, ...write })
    ).rejects.toThrow("already exists");

    const unchanged = await updateCompanyIdentifier({
      companyIdentifier: { id: "ci_legacy", companyId: company.id, scheme: "9933", identifier: "EL094014201" },
      ...write,
    });
    expect(unchanged).toMatchObject({ id: "ci_legacy", identifier: "el094014201" });
    expect(await identifierRows(company.id)).toEqual([{ id: "ci_legacy", address: "9933:el094014201" }]);
  });

  it("does not take a value that differs without the prefix for the stored one", async () => {
    const company = await createCompany({ ...greekCompany, vatNumber: "EL094019245" });
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_legacy', $1, '9933', 'el094019245')`,
      [company.id]
    );
    await expect(
      updateCompanyIdentifier({
        companyIdentifier: { id: "ci_legacy", companyId: company.id, scheme: "9933", identifier: "094014201" },
        ...write,
      })
    ).rejects.toThrow("must match the company VAT number");
  });
});
