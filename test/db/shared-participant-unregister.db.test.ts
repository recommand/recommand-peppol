import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// Two companies can hold the same identifier while only one of them is published:
// for instance two shops of one legal entity, one receiving and one send-only. The
// SMP has a single participant for the identifier, and it is the published
// company's. Nothing the other company does, including asking to be registered
// itself, may delete it. The SMPs are replaced by a scripted fetch; the companies
// are real rows.

let pool: Pool;
let updateCompany: typeof import("../../data/companies").updateCompany;
let finalizeCompanyVerification: typeof import("../../data/company-verification").finalizeCompanyVerification;
let unregisterCompanyRegistrations: typeof import("../../data/smp-providers").unregisterCompanyRegistrations;
let unregisterCompanyDocumentType: typeof import("../../data/smp-providers").unregisterCompanyDocumentType;
let unregisterCompanyIdentifier: typeof import("../../data/smp-providers").unregisterCompanyIdentifier;
let isIdentifierPublishedByAnotherCompany: typeof import("../../data/company-identifiers").isIdentifierPublishedByAnotherCompany;

const TEAM = "team_shared";
const STRICT_TEAM = "team_shared_strict";
const TEST_NETWORK_TEAM = "team_shared_test_network";
const PUBLISHED = "c_published";
const SEND_ONLY = "c_send_only";

const requests: { url: string; method?: string }[] = [];
// How the SMP answers a DELETE, and where the SML resolves participants to (null: no record).
let deleteStatus = 200;
let smlTarget: string | null = null;
const alerts: string[] = [];

const fetchMock = spyOn(globalThis, "fetch");
fetchMock.mockImplementation(
  Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method });
      if (init?.method === "DELETE" && deleteStatus !== 200) {
        return new Response("Not found", { status: deleteStatus });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
    { preconnect: globalThis.fetch.preconnect },
  ),
);

function deletes() {
  return requests.filter((request) => request.method === "DELETE").map((request) => request.url);
}

const BOTH_SERVICE_GROUPS = [
  "https://smp.net.recommand.com/iso6523-actorid-upis::0208:0123456749",
  "https://smp.net.recommand.com/iso6523-actorid-upis::9925:be0123456749",
];

async function seedTeam(id: string, options: { isPlayground?: boolean; useTestNetwork?: boolean; verificationRequirements?: string } = {}) {
  await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [id]);
  await pool.query(
    `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [id, options.isPlayground ?? false, options.useTestNetwork ?? false, options.verificationRequirements ?? "trusted"]
  );
}

async function seedCompany(id: string, teamId: string, options: { isSmpRecipient: boolean; smpProvider?: string }) {
  await pool.query(
    `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number_scheme, enterprise_number, vat_number,
       is_smp_recipient, is_verified, access_point_provider, smp_provider)
     VALUES ($1, $2, 'Example vzw', 'Straat 1', '9000', 'Gent', 'BE', '0208', '0123456749', 'BE0123456749', $3, false, 'recommand-ap1', $4)`,
    [id, teamId, options.isSmpRecipient, options.smpProvider ?? "recommand-smp1"]
  );
  for (const [scheme, identifier] of [["0208", "0123456749"], ["9925", "be0123456749"]]) {
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ($1, $2, $3, $4)`,
      [`${id}_${scheme}`, id, scheme, identifier]
    );
  }
}

async function identifierOf(companyId: string, scheme: string) {
  const { rows } = await pool.query(`SELECT * FROM peppol_company_identifiers WHERE company_id = $1 AND scheme = $2`, [companyId, scheme]);
  const row = rows[0];
  return { ...row, companyId: row.company_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

describe.skipIf(!testDatabaseUrl)("unregistering an identifier another company publishes", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({
      sendSystemAlert: async (title: string) => {
        alerts.push(title);
      },
    }));
    mock.module("@peppol/utils/naptr", () => ({ resolveNaptr: async () => smlTarget }));
    // The event registry is set up when the app starts, which these tests do not do.
    mock.module("@peppol/data/company-verification-webhooks", () => ({ publishCompanyVerificationEvent: async () => {} }));
    ({ updateCompany } = await import("../../data/companies"));
    ({ finalizeCompanyVerification } = await import("../../data/company-verification"));
    ({ unregisterCompanyRegistrations, unregisterCompanyDocumentType, unregisterCompanyIdentifier } = await import("../../data/smp-providers"));
    ({ isIdentifierPublishedByAnotherCompany } = await import("../../data/company-identifiers"));
    await seedTeam(TEAM);
    await seedTeam(STRICT_TEAM, { verificationRequirements: "strict" });
    await seedTeam(TEST_NETWORK_TEAM, { isPlayground: true, useTestNetwork: true });
  });

  afterAll(async () => {
    fetchMock.mockRestore();
    await pool?.end();
  });

  beforeEach(async () => {
    requests.length = 0;
    alerts.length = 0;
    deleteStatus = 200;
    smlTarget = null;
    await pool.query("TRUNCATE peppol_companies CASCADE");
    await seedCompany(PUBLISHED, TEAM, { isSmpRecipient: true });
    await seedCompany(SEND_ONLY, TEAM, { isSmpRecipient: false });
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  it("refuses to register the other company before anything reaches the SMP", async () => {
    await expect(updateCompany({ id: SEND_ONLY, teamId: TEAM, isSmpRecipient: true })).rejects.toThrow(
      "already registered as recipient with another company"
    );

    expect(requests).toEqual([]);
    const { rows } = await pool.query(`SELECT is_smp_recipient FROM peppol_companies WHERE id = $1`, [SEND_ONLY]);
    expect(rows[0].is_smp_recipient).toBe(false);
  });

  it("refuses a verification that would register the other company before anything reaches the SMP", async () => {
    await pool.query("TRUNCATE peppol_companies CASCADE");
    await seedCompany(PUBLISHED, TEAM, { isSmpRecipient: true });
    await seedCompany(SEND_ONLY, STRICT_TEAM, { isSmpRecipient: true });
    await pool.query(
      `INSERT INTO company_verification_log (id, company_id, status, company_name, enterprise_number, address, postal_code, city, country)
       VALUES ('cvl_shared', $1, 'inReview', 'Example vzw', '0123456749', 'Straat 1', '9000', 'Gent', 'BE')`,
      [SEND_ONLY]
    );
    const { rows: [company] } = await pool.query(`SELECT * FROM peppol_companies WHERE id = $1`, [SEND_ONLY]);

    const result = await finalizeCompanyVerification({
      companyVerificationLogId: "cvl_shared",
      company: { ...company, teamId: company.team_id, isSmpRecipient: true, isVerified: false, smpProvider: "recommand-smp1" },
      status: "verified",
      verificationProofReference: "proof",
    });

    expect(result).toMatchObject({ status: "error", errorMessage: expect.stringContaining("already registered as recipient with another company") });
    expect(requests.filter((request) => request.url.includes("smp.net.recommand.com"))).toEqual([]);
    const { rows: [log] } = await pool.query(`SELECT status FROM company_verification_log WHERE id = 'cvl_shared'`);
    expect(log.status).toBe("error");
  });

  it("leaves the published company's service groups when the other company is unregistered", async () => {
    await unregisterCompanyRegistrations({ companyId: SEND_ONLY, useTestNetwork: false });
    expect(deletes()).toEqual([]);
  });

  it("leaves its document types when one is removed from the other company", async () => {
    await unregisterCompanyDocumentType({
      documentType: {
        id: "cdt_shared",
        companyId: SEND_ONLY,
        docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
        processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      useTestNetwork: false,
    });
    expect(deletes()).toEqual([]);
  });

  it("deletes the service groups when the published company itself is unregistered", async () => {
    await unregisterCompanyRegistrations({ companyId: PUBLISHED, useTestNetwork: false });
    expect(deletes().sort()).toEqual(BOTH_SERVICE_GROUPS);
  });

  it("does not count a company published on the other network", async () => {
    await pool.query(`UPDATE peppol_companies SET team_id = $1 WHERE id = $2`, [TEST_NETWORK_TEAM, PUBLISHED]);
    await unregisterCompanyRegistrations({ companyId: SEND_ONLY, useTestNetwork: false });
    expect(deletes().sort()).toEqual(BOTH_SERVICE_GROUPS);
  });

  it("does not count a recipient that is not published because it still has to be verified", async () => {
    await pool.query(`UPDATE peppol_companies SET team_id = $1 WHERE id = $2`, [STRICT_TEAM, PUBLISHED]);
    await unregisterCompanyRegistrations({ companyId: SEND_ONLY, useTestNetwork: false });
    expect(deletes().sort()).toEqual(BOTH_SERVICE_GROUPS);
  });

  it("does not count an unverified French company of a lax team, which is not published", async () => {
    await pool.query(`UPDATE peppol_companies SET smp_provider = 'at-shared-smp-fr'`);
    expect(
      await isIdentifierPublishedByAnotherCompany({
        identifier: await identifierOf(SEND_ONLY, "0208"),
        smpProvider: "at-shared-smp-fr",
        useTestNetwork: false,
      })
    ).toBe(false);
  });

  it("does not count a company published through the partner SMP", async () => {
    await pool.query(`UPDATE peppol_companies SET smp_provider = 'at-shared-smp-fr' WHERE id = $1`, [PUBLISHED]);
    await unregisterCompanyRegistrations({ companyId: SEND_ONLY, useTestNetwork: false });
    expect(deletes().sort()).toEqual(BOTH_SERVICE_GROUPS);
  });

  it("leaves the partner SMP's participant of another published company", async () => {
    await pool.query(`UPDATE peppol_companies SET smp_provider = 'at-shared-smp-fr'`);
    // The French network publishes a company only once it is verified, whatever its team's level.
    await pool.query(`UPDATE peppol_companies SET is_verified = true WHERE id = $1`, [PUBLISHED]);
    await unregisterCompanyIdentifier({ identifier: await identifierOf(SEND_ONLY, "0208"), useTestNetwork: false });
    expect(requests).toEqual([]);
  });

  describe("a published company whose service groups are already gone", () => {
    it("is unregistered, and support is alerted while the SML still points to our SMP", async () => {
      deleteStatus = 404;
      smlTarget = "https://smp.net.recommand.com";
      await unregisterCompanyRegistrations({ companyId: PUBLISHED, useTestNetwork: false });
      expect(deletes().sort()).toEqual(BOTH_SERVICE_GROUPS);
      expect(alerts).toEqual(["Participant Left In SML Without Service Group", "Participant Left In SML Without Service Group"]);
    });

    it("is unregistered without an alert when the SML points to another SMP", async () => {
      deleteStatus = 404;
      smlTarget = "https://smp.example.com";
      await unregisterCompanyRegistrations({ companyId: PUBLISHED, useTestNetwork: false });
      expect(deletes().sort()).toEqual(BOTH_SERVICE_GROUPS);
      expect(alerts).toEqual([]);
    });

    it("is unregistered without an alert when the SML has no record of it", async () => {
      deleteStatus = 404;
      await unregisterCompanyRegistrations({ companyId: PUBLISHED, useTestNetwork: false });
      expect(deletes().sort()).toEqual(BOTH_SERVICE_GROUPS);
      expect(alerts).toEqual([]);
    });
  });
});
