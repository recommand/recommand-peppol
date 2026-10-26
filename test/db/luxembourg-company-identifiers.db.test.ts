import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A Luxembourg company is addressed under 9938 by its VAT number and by its
// matricule. Its enterprise number is its matricule or its RCS number; a matricule is
// published under 9938 and under 0240, the register of legal persons' own scheme,
// while the company keeps sending under its VAT number. 0240 only ever takes the
// company's own matricule. The SMP and the SML
// are replaced by scripted answers; the companies are real rows.

let pool: Pool;
let createCompany: typeof import("../../data/companies").createCompany;
let createCompanyIdentifier: typeof import("../../data/company-identifiers").createCompanyIdentifier;
let getSendingCompanyIdentifier: typeof import("../../data/company-identifiers").getSendingCompanyIdentifier;

const PLAYGROUND = "team_lu";
const VAT = "9938:lu15027442";
const MATRICULE = "0240:20042228800";
const MATRICULE_9938 = "9938:20042228800";

const fetchMock = spyOn(globalThis, "fetch");
fetchMock.mockImplementation(
  Object.assign(
    async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    { preconnect: globalThis.fetch.preconnect },
  ),
);

async function identifierRows(companyId: string) {
  const { rows } = await pool.query(
    `SELECT scheme || ':' || identifier AS address
     FROM peppol_company_identifiers WHERE company_id = $1 ORDER BY scheme, identifier`,
    [companyId]
  );
  return rows.map((row) => row.address as string);
}

const luxembourgCompany = {
  teamId: PLAYGROUND,
  name: "Exemple SA",
  address: "1 rue de l'Exemple",
  postalCode: "1111",
  city: "Luxembourg",
  country: "LU" as const,
  enterpriseNumber: "20042228800",
  vatNumber: "LU15027442",
  isSmpRecipient: true,
  skipDefaultCompanySetup: false,
};

const write = { skipSmpRegistration: true, useTestNetwork: false };

describe.skipIf(!testDatabaseUrl)("Luxembourg company identifiers against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    process.env.AP_CERT = "test certificate";
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: async () => {} }));
    mock.module("@peppol/utils/naptr", () => ({
      resolveNaptr: async () => ({ status: "absent" }),
      lookUpCname: async () => ({ status: "absent" }),
      smlResolver: {},
    }));
    ({ createCompany } = await import("../../data/companies"));
    ({ createCompanyIdentifier, getSendingCompanyIdentifier } = await import("../../data/company-identifiers"));
    await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [PLAYGROUND]);
    await pool.query(
      `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements)
       VALUES ($1, true, false, 'lax') ON CONFLICT (id) DO NOTHING`,
      [PLAYGROUND]
    );
  });

  afterAll(async () => {
    fetchMock.mockRestore();
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE peppol_companies CASCADE");
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  it("creates a company with its matricule under 9938 and 0240 next to its VAT number, sending under the VAT number", async () => {
    const company = await createCompany(luxembourgCompany);
    expect(await identifierRows(company.id)).toEqual([MATRICULE, MATRICULE_9938, VAT]);
    expect(await getSendingCompanyIdentifier(company)).toMatchObject({ scheme: "9938", identifier: "lu15027442" });
  });

  it("creates the matricule identifiers for a company that names 0240 as its enterprise number scheme", async () => {
    const company = await createCompany({ ...luxembourgCompany, vatNumber: null, enterpriseNumberScheme: "0240" });
    expect(await identifierRows(company.id)).toEqual([MATRICULE, MATRICULE_9938]);
    expect(await getSendingCompanyIdentifier(company)).toMatchObject({ scheme: "9938", identifier: "20042228800" });
  });

  it("creates no 0240 identifier from an RCS number", async () => {
    const company = await createCompany({ ...luxembourgCompany, enterpriseNumber: "B123456" });
    expect(await identifierRows(company.id)).toEqual([VAT]);
  });

  it("returns a matricule identifier a request adds again, and refuses another matricule", async () => {
    const company = await createCompany(luxembourgCompany);
    for (const scheme of ["0240", "9938"]) {
      const [existing] = (
        await pool.query(
          `SELECT id FROM peppol_company_identifiers WHERE company_id = $1 AND scheme = $2 AND identifier = '20042228800'`,
          [company.id, scheme]
        )
      ).rows;
      const again = await createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme, identifier: "20042228800" }, ...write });
      expect(again.id).toBe(existing.id);
    }

    await expect(
      createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "0240", identifier: "19656100039" }, ...write })
    ).rejects.toThrow("must match the company enterprise number when it is a matricule");
    expect(await identifierRows(company.id)).toEqual([MATRICULE, MATRICULE_9938, VAT]);
  });

  it("refuses 0240 on a company of another country", async () => {
    const company = await createCompany({
      ...luxembourgCompany,
      country: "BE",
      enterpriseNumber: "0123456749",
      vatNumber: "BE0123456749",
    });
    await expect(
      createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "0240", identifier: "20042228800" }, ...write })
    ).rejects.toThrow("Scheme 0240 is for matricules from Luxembourg");
  });
});
