import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A company can name the scheme its enterprise number is under. When that is a scheme
// of no country, such as a GLN (0088), the number becomes the company's Peppol address
// under that scheme. Under one of the country's own schemes, such as the French SIREN
// (0002), it is the country's register number and is published under the country's
// default scheme, as it is without a scheme.

let pool: Pool;
let createCompany: typeof import("../../data/companies").createCompany;
let getSendingCompanyIdentifier: typeof import("../../data/company-identifiers").getSendingCompanyIdentifier;

const TEAM = "team_enterprise_scheme";
const GLN = "7300009000005";

async function identifierRows(companyId: string) {
  const { rows } = await pool.query(
    `SELECT scheme || ':' || identifier AS address
     FROM peppol_company_identifiers WHERE company_id = $1 ORDER BY scheme, identifier`,
    [companyId]
  );
  return rows.map((row) => row.address as string);
}

const swedishCompany = {
  teamId: TEAM,
  name: "Golv Enskild Firma",
  address: "Storgatan 1",
  postalCode: "11122",
  city: "Stockholm",
  country: "SE" as const,
  vatNumber: null,
  isSmpRecipient: false,
  skipDefaultCompanySetup: false,
};

describe.skipIf(!testDatabaseUrl)("Enterprise number scheme of a new company against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/data/smp-providers", () => ({
      upsertCompanyRegistrations: async () => {},
      unregisterCompanyRegistrations: async () => {},
      upsertCompanyRegistration: async () => {},
      unregisterCompanyIdentifier: async () => {},
      unregisterCompanyDocumentType: async () => {},
      replaceCompanyDocumentType: async () => {},
      upsertCompanyDocumentTypeRegistration: async () => {},
    }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: async () => {} }));
    ({ createCompany } = await import("../../data/companies"));
    ({ getSendingCompanyIdentifier } = await import("../../data/company-identifiers"));
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

  it("publishes a GLN named as enterprise number under 0088 and sends from it", async () => {
    const company = await createCompany({ ...swedishCompany, enterpriseNumber: GLN, enterpriseNumberScheme: "0088" });
    expect(await identifierRows(company.id)).toEqual([`0088:${GLN}`]);
    const sender = await getSendingCompanyIdentifier(company);
    expect(`${sender.scheme}:${sender.identifier}`).toBe(`0088:${GLN}`);
  });

  it("still publishes a Swedish organisation number under 0007", async () => {
    const company = await createCompany({ ...swedishCompany, enterpriseNumber: "2021005448", enterpriseNumberScheme: "0007" });
    expect(await identifierRows(company.id)).toEqual(["0007:2021005448"]);
  });

  it("publishes a SIREN named under the French 0002 under the default 0225", async () => {
    const company = await createCompany({
      ...swedishCompany,
      name: "Exemple SAS",
      country: "FR",
      enterpriseNumber: "303265045",
      enterpriseNumberScheme: "0002",
    });
    expect(await identifierRows(company.id)).toEqual(["0225:303265045"]);
  });

  it("gives a German register number named under the old 0204 no Leitweg-ID", async () => {
    const company = await createCompany({
      ...swedishCompany,
      name: "Beispiel GmbH",
      country: "DE",
      enterpriseNumber: "HRB 12345",
      enterpriseNumberScheme: "0204",
      vatNumber: "DE136695976",
    });
    expect(await identifierRows(company.id)).toEqual(["0246:de136695976", "9930:de136695976"]);
  });
});
