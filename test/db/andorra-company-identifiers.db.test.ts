import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// An Andorran company records its NRT as its enterprise number and is published under
// 9922 from it, with the AD prefix, whether or not it has a VAT number. The SMP and the
// SML are replaced by scripted answers; the companies are real rows.

let pool: Pool;
let createCompany: typeof import("../../data/companies").createCompany;
let createCompanyIdentifier: typeof import("../../data/company-identifiers").createCompanyIdentifier;
let getSendingCompanyIdentifier: typeof import("../../data/company-identifiers").getSendingCompanyIdentifier;

const PLAYGROUND = "team_ad";
const NRT_ADDRESS = "9922:adl712345a";

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

const andorranCompany = {
  teamId: PLAYGROUND,
  name: "Exemple SL",
  address: "Avinguda Meritxell 1",
  postalCode: "AD500",
  city: "Andorra la Vella",
  country: "AD" as const,
  enterpriseNumber: "L-712345-A",
  vatNumber: null,
  isSmpRecipient: false,
  skipDefaultCompanySetup: false,
};

const write = { skipSmpRegistration: true, useTestNetwork: false };

describe.skipIf(!testDatabaseUrl)("Andorran company identifiers against PostgreSQL", () => {
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

  it("creates a company without a VAT number that sends under its NRT in 9922", async () => {
    const company = await createCompany(andorranCompany);
    expect(await identifierRows(company.id)).toEqual([NRT_ADDRESS]);
    expect(await getSendingCompanyIdentifier(company)).toMatchObject({ scheme: "9922", identifier: "adl712345a" });
  });

  it("creates the same single identifier when the VAT number holds the NRT as well", async () => {
    const company = await createCompany({ ...andorranCompany, vatNumber: "ADL712345A" });
    expect(await identifierRows(company.id)).toEqual([NRT_ADDRESS]);
  });

  it("refuses a malformed NRT", async () => {
    await expect(createCompany({ ...andorranCompany, enterpriseNumber: "L612345A" })).rejects.toThrow("Andorran NRT must be");
  });

  it("takes the company's bare NRT under 9922 when it is added, and refuses another company's", async () => {
    const company = await createCompany(andorranCompany);
    await createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "9922", identifier: "L712345A" }, ...write });
    await expect(
      createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "9922", identifier: "ADA700001B" }, ...write })
    ).rejects.toThrow("must match the company NRT");
    expect(await identifierRows(company.id)).toEqual([NRT_ADDRESS, "9922:l712345a"]);
    expect(await getSendingCompanyIdentifier(company)).toMatchObject({ scheme: "9922", identifier: "adl712345a" });
  });
});
