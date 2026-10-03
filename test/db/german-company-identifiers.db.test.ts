import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A German company is addressed by its VAT number. Its register number is a legal
// identifier for the invoice, not a Peppol address, so creating the company must not
// turn it into a Leitweg-ID (0204), and a Leitweg-ID the company does hold is never
// the address it sends from.

let pool: Pool;
let createCompany: typeof import("../../data/companies").createCompany;
let createCompanyIdentifier: typeof import("../../data/company-identifiers").createCompanyIdentifier;
let getSendingCompanyIdentifier: typeof import("../../data/company-identifiers").getSendingCompanyIdentifier;

const TEAM = "team_de";

async function identifierRows(companyId: string) {
  const { rows } = await pool.query(
    `SELECT scheme || ':' || identifier AS address
     FROM peppol_company_identifiers WHERE company_id = $1 ORDER BY scheme, identifier`,
    [companyId]
  );
  return rows.map((row) => row.address as string);
}

const germanCompany = {
  teamId: TEAM,
  name: "Beispiel GmbH",
  address: "Musterstraße 1",
  postalCode: "10115",
  city: "Berlin",
  country: "DE" as const,
  enterpriseNumber: "HRB 12345",
  vatNumber: "DE136695976",
  isSmpRecipient: true,
  skipDefaultCompanySetup: false,
};

describe.skipIf(!testDatabaseUrl)("German company identifiers against PostgreSQL", () => {
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
    ({ createCompanyIdentifier, getSendingCompanyIdentifier } = await import("../../data/company-identifiers"));
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

  it("creates a German company with its VAT number under 9930 and no Leitweg-ID", async () => {
    const company = await createCompany(germanCompany);
    expect(company.enterpriseNumberScheme).toBeNull();
    expect(await identifierRows(company.id)).toEqual(["9930:de136695976"]);
  });

  it("still accepts a real Leitweg-ID added explicitly, without sending under it", async () => {
    const company = await createCompany(germanCompany);
    await createCompanyIdentifier({
      companyIdentifier: { companyId: company.id, scheme: "0204", identifier: "991-33333TEST-33" },
      skipSmpRegistration: true,
      useTestNetwork: false,
    });
    expect(await identifierRows(company.id)).toEqual(["0204:991-33333test-33", "9930:de136695976"]);
    expect(await getSendingCompanyIdentifier(company)).toMatchObject({ scheme: "9930" });
    await expect(createCompanyIdentifier({
      companyIdentifier: { companyId: company.id, scheme: "0204", identifier: "HRB12345" },
      skipSmpRegistration: true,
      useTestNetwork: false,
    })).rejects.toThrow("Leitweg-ID must consist of");
    await expect(createCompanyIdentifier({
      companyIdentifier: { companyId: company.id, scheme: "9958", identifier: "991-33333TEST-33" },
      skipSmpRegistration: true,
      useTestNetwork: false,
    })).rejects.toThrow("deprecated");
  });
});
