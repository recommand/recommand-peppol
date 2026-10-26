import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A German company is addressed by its VAT number, under 9930 and as its GEBA under
// 0246, and sends under 9930. Its register number is a legal identifier for the
// invoice, not a Peppol address, so creating the company must not turn it into a
// Leitweg-ID (0204), and a Leitweg-ID the company does hold is never the address it
// sends from. The GEBA is ours to add, so it never holds up a registration. The SMP
// and the SML are replaced by scripted answers; the companies are real rows.

let pool: Pool;
let createCompany: typeof import("../../data/companies").createCompany;
let updateCompany: typeof import("../../data/companies").updateCompany;
let findCompanyByPeppolId: typeof import("../../data/companies").findCompanyByPeppolId;
let createCompanyIdentifier: typeof import("../../data/company-identifiers").createCompanyIdentifier;
let getSendingCompanyIdentifier: typeof import("../../data/company-identifiers").getSendingCompanyIdentifier;

const PLAYGROUND = "team_de";
const PRODUCTION = "team_de_production";
const VAT = "9930:de136695976";
const GEBA = "0246:de136695976";

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
    .filter((request) => request.method === "PUT" && /^https:\/\/smp\.net\.recommand\.com\/iso6523-actorid-upis::[^/]+$/.test(request.url))
    .map((request) => request.url.split("::")[1]);

async function identifierRows(companyId: string) {
  const { rows } = await pool.query(
    `SELECT scheme || ':' || identifier AS address
     FROM peppol_company_identifiers WHERE company_id = $1 ORDER BY scheme, identifier`,
    [companyId]
  );
  return rows.map((row) => row.address as string);
}

async function seedTeam(id: string, isPlayground: boolean) {
  await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [id]);
  await pool.query(
    `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements)
     VALUES ($1, $2, false, 'lax') ON CONFLICT (id) DO NOTHING`,
    [id, isPlayground]
  );
}

const germanCompany = {
  teamId: PLAYGROUND,
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

/** A production company that only sends, so it is on no SMP yet. */
const sendOnly = async () =>
  await createCompany({ ...germanCompany, teamId: PRODUCTION, isSmpRecipient: false });

describe.skipIf(!testDatabaseUrl)("German company identifiers against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    // Registering a company's document types on the SMP names our access point's certificate.
    process.env.AP_CERT = "test certificate";
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: async () => {} }));
    mock.module("@peppol/utils/naptr", () => ({
      resolveNaptr: async () => (smlAnswer ? { status: "found", smpUrl: smlAnswer } : { status: "absent" }),
      lookUpCname: async () => ({ status: "absent" }),
      smlResolver: {},
    }));
    ({ createCompany, updateCompany, findCompanyByPeppolId } = await import("../../data/companies"));
    ({ createCompanyIdentifier, getSendingCompanyIdentifier } = await import("../../data/company-identifiers"));
    await seedTeam(PLAYGROUND, true);
    await seedTeam(PRODUCTION, false);
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

  it("creates a German company with its VAT number under 9930 and 0246 and no Leitweg-ID, sending under 9930", async () => {
    const company = await createCompany(germanCompany);
    expect(company.enterpriseNumberScheme).toBeNull();
    expect(await identifierRows(company.id)).toEqual([GEBA, VAT]);
    expect(await getSendingCompanyIdentifier(company, "0246:DE811569869")).toMatchObject({ scheme: "9930" });
    // A document addressed to the GEBA finds the company.
    expect(await findCompanyByPeppolId({ peppolId: "0246:DE136695976", playgroundTeamId: PLAYGROUND })).toMatchObject({ id: company.id });
  });

  it("creates no GEBA without a VAT number", async () => {
    const company = await createCompany({ ...germanCompany, vatNumber: null });
    expect(await identifierRows(company.id)).toEqual([]);
  });

  it("returns the GEBA a request adds again, and takes one with a distinctive feature", async () => {
    const company = await createCompany(germanCompany);
    const [existing] = (
      await pool.query(`SELECT id FROM peppol_company_identifiers WHERE company_id = $1 AND scheme = '0246'`, [company.id])
    ).rows;
    const write = { skipSmpRegistration: true, useTestNetwork: false };

    const again = await createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "0246", identifier: "DE136695976" }, ...write });
    expect(again.id).toBe(existing.id);

    await createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "0246", identifier: "DE136695976-00001" }, ...write });
    await expect(
      createCompanyIdentifier({ companyIdentifier: { companyId: company.id, scheme: "0246", identifier: "DE811569869" }, ...write })
    ).rejects.toThrow("must start with the company VAT number");
    expect(await identifierRows(company.id)).toEqual([GEBA, "0246:de136695976-00001", VAT]);
    expect(await getSendingCompanyIdentifier(company)).toMatchObject({ scheme: "9930" });
  });

  it("still accepts a real Leitweg-ID added explicitly, without sending under it", async () => {
    const company = await createCompany(germanCompany);
    await createCompanyIdentifier({
      companyIdentifier: { companyId: company.id, scheme: "0204", identifier: "991-33333TEST-33" },
      skipSmpRegistration: true,
      useTestNetwork: false,
    });
    expect(await identifierRows(company.id)).toEqual(["0204:991-33333test-33", GEBA, VAT]);
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

  it("registers the GEBA on the SMP next to the VAT number", async () => {
    const company = await createCompany({ ...germanCompany, teamId: PRODUCTION });
    expect(await identifierRows(company.id)).toEqual([GEBA, VAT]);
    expect(serviceGroupsCreated().sort()).toEqual([GEBA, VAT]);
  });

  it("keeps a send-only company's GEBA off the SMP until it becomes a recipient", async () => {
    const company = await sendOnly();
    expect(await identifierRows(company.id)).toEqual([GEBA, VAT]);
    expect(serviceGroupsCreated()).toEqual([]);

    await updateCompany({ id: company.id, teamId: PRODUCTION, isSmpRecipient: true });
    expect(serviceGroupsCreated().sort()).toEqual([GEBA, VAT]);
  });

  it("becomes a recipient without the GEBA when another SMP publishes it", async () => {
    const company = await sendOnly();
    smlAnswer = "https://smp.example.org";

    await updateCompany({ id: company.id, teamId: PRODUCTION, isSmpRecipient: true });
    expect(await identifierRows(company.id)).toEqual([VAT]);
    expect(serviceGroupsCreated()).toEqual([VAT]);
  });

  it("becomes a recipient without the GEBA when the SMP refuses it", async () => {
    const company = await sendOnly();
    refusedServiceGroups = [GEBA];

    const updated = await updateCompany({ id: company.id, teamId: PRODUCTION, isSmpRecipient: true });
    expect(updated.isSmpRecipient).toBe(true);
    expect(await identifierRows(company.id)).toEqual([VAT]);
    expect(serviceGroupsCreated()).toContain(VAT);
  });

  it("still refuses a recipient over a VAT number another recipient holds, without unregistering it", async () => {
    const company = await sendOnly();
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, vat_number,
         is_smp_recipient, is_verified, access_point_provider, smp_provider)
       VALUES ('c_de_other', $1, 'Beispiel GmbH', 'Musterstraße 2', '10115', 'Berlin', 'DE', 'DE136695976', true, true, 'recommand-ap1', 'recommand-smp1')`,
      [PRODUCTION]
    );
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_other', 'c_de_other', '9930', 'de136695976')`
    );

    await expect(updateCompany({ id: company.id, teamId: PRODUCTION, isSmpRecipient: true })).rejects.toThrow(
      "already registered as recipient with another company"
    );
    const { rows: [row] } = await pool.query(`SELECT is_smp_recipient FROM peppol_companies WHERE id = $1`, [company.id]);
    expect(row.is_smp_recipient).toBe(false);
    expect(requests.filter((request) => request.method === "DELETE")).toEqual([]);
  });
});
