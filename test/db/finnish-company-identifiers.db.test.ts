import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A Finnish company gets its OVT code (0216) by default. That identifier is ours to
// add, so it never holds up the company: a request that adds it again gets it back,
// and when it is already published elsewhere the verification goes ahead without it.
// The SMPs and the SML are replaced by scripted answers; the companies are real rows.

let pool: Pool;
let createCompany: typeof import("../../data/companies").createCompany;
let createCompanyIdentifier: typeof import("../../data/company-identifiers").createCompanyIdentifier;
let finalizeCompanyVerification: typeof import("../../data/company-verification").finalizeCompanyVerification;

const PLAYGROUND = "team_fi_playground";
const STRICT_TEAM = "team_fi_strict";
const COMPANY = "c_fi";
const OVT = "0216:003702454583";

const requests: { url: string; method?: string }[] = [];
// The service groups the SMP refuses to create, and where the SML says participants are.
let refusedServiceGroups: string[] = [];
let smlAnswer: string | null = null;

const fetchMock = spyOn(globalThis, "fetch");
fetchMock.mockImplementation(
  Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method });
      if (init?.method === "PUT" && refusedServiceGroups.some((address) => url.endsWith(`::${address}`))) {
        return new Response("Conflict", { status: 409 });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
    { preconnect: globalThis.fetch.preconnect },
  ),
);

const serviceGroupsCreated = () =>
  requests
    .filter((request) => request.method === "PUT" && request.url.startsWith("https://smp.net.recommand.com/iso6523-actorid-upis::"))
    .map((request) => request.url.split("::")[1]);

async function identifierRows(companyId: string) {
  const { rows } = await pool.query(
    `SELECT scheme || ':' || identifier AS address FROM peppol_company_identifiers WHERE company_id = $1 ORDER BY scheme, identifier`,
    [companyId]
  );
  return rows.map((row) => row.address as string);
}

async function seedTeam(id: string, options: { isPlayground: boolean; verificationRequirements: string }) {
  await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [id]);
  await pool.query(
    `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements)
     VALUES ($1, $2, false, $3) ON CONFLICT (id) DO NOTHING`,
    [id, options.isPlayground, options.verificationRequirements]
  );
}

/** A Finnish company awaiting verification, with its OVT code and any further identifiers. */
async function seedCompanyInReview(extraIdentifiers: [string, string][] = []) {
  await pool.query(
    `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, vat_number,
       is_smp_recipient, is_verified, access_point_provider, smp_provider)
     VALUES ($1, $2, 'Esimerkki Oy', 'Katu 1', '00100', 'Helsinki', 'FI', 'FI02454583', true, false, 'recommand-ap1', 'recommand-smp1')`,
    [COMPANY, STRICT_TEAM]
  );
  for (const [scheme, identifier] of [["0216", "003702454583"], ...extraIdentifiers]) {
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ($1, $2, $3, $4)`,
      [`ci_${scheme}`, COMPANY, scheme, identifier]
    );
  }
  await pool.query(
    `INSERT INTO company_verification_log (id, company_id, status, company_name, enterprise_number, address, postal_code, city, country)
     VALUES ('cvl_fi', $1, 'inReview', 'Esimerkki Oy', null, 'Katu 1', '00100', 'Helsinki', 'FI')`,
    [COMPANY]
  );
  const { rows: [company] } = await pool.query(`SELECT * FROM peppol_companies WHERE id = $1`, [COMPANY]);
  return {
    ...company,
    teamId: company.team_id,
    country: company.country,
    vatNumber: company.vat_number,
    enterpriseNumber: company.enterprise_number,
    isSmpRecipient: true,
    isVerified: false,
    smpProvider: "recommand-smp1",
  };
}

const verify = async (company: Awaited<ReturnType<typeof seedCompanyInReview>>) =>
  await finalizeCompanyVerification({ companyVerificationLogId: "cvl_fi", company, status: "verified", verificationProofReference: "proof" });

describe.skipIf(!testDatabaseUrl)("Finnish company identifiers against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: async () => {} }));
    mock.module("@peppol/utils/naptr", () => ({ resolveNaptr: async () => smlAnswer }));
    // The event registry is set up when the app starts, which these tests do not do.
    mock.module("@peppol/data/company-verification-webhooks", () => ({ publishCompanyVerificationEvent: async () => {} }));
    ({ createCompany } = await import("../../data/companies"));
    ({ createCompanyIdentifier } = await import("../../data/company-identifiers"));
    ({ finalizeCompanyVerification } = await import("../../data/company-verification"));
    await seedTeam(PLAYGROUND, { isPlayground: true, verificationRequirements: "lax" });
    await seedTeam(STRICT_TEAM, { isPlayground: false, verificationRequirements: "strict" });
  });

  afterAll(async () => {
    fetchMock.mockRestore();
    await pool?.end();
  });

  beforeEach(async () => {
    requests.length = 0;
    refusedServiceGroups = [];
    smlAnswer = null;
    await pool.query("TRUNCATE peppol_companies CASCADE");
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  it("creates a Finnish company with its OVT code", async () => {
    const company = await createCompany({
      teamId: PLAYGROUND, name: "Esimerkki Oy", address: "Katu 1", postalCode: "00100", city: "Helsinki", country: "FI",
      enterpriseNumber: null, vatNumber: "FI02454583", isSmpRecipient: true, skipDefaultCompanySetup: false,
    });
    expect(await identifierRows(company.id)).toEqual([OVT]);
  });

  it("returns the OVT code a request adds again, and refuses other duplicates", async () => {
    const company = await createCompany({
      teamId: PLAYGROUND, name: "Esimerkki Oy", address: "Katu 1", postalCode: "00100", city: "Helsinki", country: "FI",
      enterpriseNumber: null, vatNumber: "FI02454583", isSmpRecipient: true, skipDefaultCompanySetup: false,
    });
    const [existing] = (await pool.query(`SELECT id FROM peppol_company_identifiers WHERE company_id = $1`, [company.id])).rows;
    const write = { skipSmpRegistration: true, useTestNetwork: false };

    const again = await createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "0216", identifier: "003702454583" }, ...write });
    expect(again.id).toBe(existing.id);

    await createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "0216", identifier: "003702454583TST01" }, ...write });
    await expect(
      createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "0216", identifier: "003702454583TST01" }, ...write })
    ).rejects.toThrow("already exists");
    await expect(
      createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "0216", identifier: "003701120389" }, ...write })
    ).rejects.toThrow("must contain the company's Business ID");
    expect(await identifierRows(company.id)).toEqual([OVT, "0216:003702454583tst01"]);
  });

  it("verifies a company whose OVT code another SMP publishes, without it", async () => {
    smlAnswer = "https://smp.example.org";
    const company = await seedCompanyInReview([["0088", "4000001000005"]]);

    expect(await verify(company)).toMatchObject({ status: "verified" });
    expect(await identifierRows(COMPANY)).toEqual(["0088:4000001000005"]);
    expect(serviceGroupsCreated()).toEqual(["0088:4000001000005"]);
  });

  it("verifies a company whose OVT code another recipient here holds, without it", async () => {
    const company = await seedCompanyInReview([["0088", "4000001000005"]]);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, vat_number,
         is_smp_recipient, is_verified, access_point_provider, smp_provider)
       VALUES ('c_fi_other', $1, 'Esimerkki Oy', 'Katu 2', '00100', 'Helsinki', 'FI', 'FI02454583', true, true, 'recommand-ap1', 'recommand-smp1')`,
      [STRICT_TEAM]
    );
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_other', 'c_fi_other', '0216', '003702454583')`
    );

    expect(await verify(company)).toMatchObject({ status: "verified" });
    expect(await identifierRows(COMPANY)).toEqual(["0088:4000001000005"]);
    expect(await identifierRows("c_fi_other")).toEqual([OVT]);
  });

  it("keeps the OVT code when our own SMP is the one the SML names", async () => {
    smlAnswer = "https://smp.net.recommand.com";
    const company = await seedCompanyInReview();

    expect(await verify(company)).toMatchObject({ status: "verified" });
    expect(await identifierRows(COMPANY)).toEqual([OVT]);
  });

  it("verifies a company whose OVT code the SMP refuses, without it", async () => {
    refusedServiceGroups = [OVT];
    const company = await seedCompanyInReview([["0088", "4000001000005"]]);

    expect(await verify(company)).toMatchObject({ status: "verified" });
    expect(await identifierRows(COMPANY)).toEqual(["0088:4000001000005"]);
    expect(serviceGroupsCreated()).toContain("0088:4000001000005");
  });

  it("still fails a verification over an identifier the customer added, and keeps the OVT code", async () => {
    refusedServiceGroups = ["0088:4000001000005"];
    const company = await seedCompanyInReview([["0088", "4000001000005"]]);

    expect(await verify(company)).toMatchObject({ status: "error", errorMessage: expect.stringContaining("0088:4000001000005") });
    expect(await identifierRows(COMPANY)).toEqual(["0088:4000001000005", OVT]);
  });
});
