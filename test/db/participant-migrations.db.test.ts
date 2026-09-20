import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A migration key moves a participant between SMPs, and what our side has to get
// right is the bookkeeping around the SMP calls: which key is used when the company
// is finally registered, what a refused key leaves behind, and what happens to the
// identifier once a participant left. The SMP itself is replaced by a scripted fetch;
// the rows are asserted against a real PostgreSQL.

let pool: Pool;
let requestInboundMigration: typeof import("../../data/participant-migrations").requestInboundMigration;
let startOutboundMigration: typeof import("../../data/participant-migrations").startOutboundMigration;
let cancelOutboundMigration: typeof import("../../data/participant-migrations").cancelOutboundMigration;
let finalizeOutboundMigration: typeof import("../../data/participant-migrations").finalizeOutboundMigration;
let getParticipantMigrations: typeof import("../../data/participant-migrations").getParticipantMigrations;
let createCompanyIdentifier: typeof import("../../data/company-identifiers").createCompanyIdentifier;
let upsertCompanyRegistrations: typeof import("../../data/smp-providers").upsertCompanyRegistrations;

const TEAM_STRICT = "team_strict";
const TEAM_LAX = "team_lax";
const KEY = "Ab12$#xyZ9!kLm";
const OTHER_KEY = "Zz98@!abYX7~Qq";

const smpRequests: { url: string; method?: string }[] = [];
let smpScript: (url: string) => Response | undefined;
// Where the SML resolves participants to; null means "no NAPTR record".
let smlTarget: string | null = null;

const fetchMock = spyOn(globalThis, "fetch");
fetchMock.mockImplementation(
  Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      smpRequests.push({ url, method: init?.method });
      return smpScript(url) ?? new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
    { preconnect: globalThis.fetch.preconnect },
  ),
);

const inboundOk = `<migrationInboundResponse success="true" serviceGroupCreated="true" migrationCreated="true" />`;
const outboundOk = `<migrationOutboundResponse success="true"><participantID>x</participantID><migrationKey>${KEY}</migrationKey></migrationOutboundResponse>`;

function smpUrls(pathPart: string) {
  return smpRequests.filter((request) => request.url.includes(pathPart)).map((request) => request.url);
}

async function seedTeam(id: string, verificationRequirements: "strict" | "lax") {
  await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [id]);
  await pool.query(
    `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements)
     VALUES ($1, false, false, $2) ON CONFLICT (id) DO NOTHING`,
    [id, verificationRequirements]
  );
}

async function seedCompany(
  id: string,
  teamId: string,
  options: { isVerified?: boolean; identifiers?: [string, string][]; smpProvider?: string } = {}
) {
  const smpProvider = options.smpProvider ?? "recommand-smp1";
  await pool.query(
    `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number_scheme, enterprise_number, vat_number,
       is_smp_recipient, is_verified, access_point_provider, smp_provider)
     VALUES ($1, $2, 'Example BV', 'Straat 1', '9000', 'Gent', 'BE', '0208', '0123456749', 'BE0123456749', true, $3, 'recommand-ap1', $4)`,
    [id, teamId, options.isVerified ?? false, smpProvider]
  );
  const identifiers = options.identifiers ?? [["0208", "0123456749"]];
  for (const [scheme, identifier] of identifiers) {
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ($1, $2, $3, $4)`,
      [`${id}_${scheme}`, id, scheme, identifier]
    );
  }
}

async function migrationRows(companyId: string) {
  const { rows } = await pool.query(
    `SELECT scheme || ':' || identifier AS address, direction, status, migration_key AS key, error_message AS error
     FROM peppol_participant_migrations WHERE company_id = $1 ORDER BY created_at, id`,
    [companyId]
  );
  return rows;
}

async function identifierRows(companyId: string) {
  const { rows } = await pool.query(
    `SELECT scheme || ':' || identifier AS address FROM peppol_company_identifiers WHERE company_id = $1 ORDER BY scheme`,
    [companyId]
  );
  return rows.map((row) => row.address as string);
}

describe.skipIf(!testDatabaseUrl)("participant migrations against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: async () => {} }));
    mock.module("@peppol/utils/naptr", () => ({ resolveNaptr: async () => smlTarget }));
    ({ requestInboundMigration, startOutboundMigration, cancelOutboundMigration, finalizeOutboundMigration, getParticipantMigrations } =
      await import("../../data/participant-migrations"));
    ({ createCompanyIdentifier } = await import("../../data/company-identifiers"));
    ({ upsertCompanyRegistrations } = await import("../../data/smp-providers"));
    await seedTeam(TEAM_STRICT, "strict");
    await seedTeam(TEAM_LAX, "lax");
  });

  afterAll(async () => {
    fetchMock.mockRestore();
    await pool?.end();
  });

  beforeEach(async () => {
    smpRequests.length = 0;
    smlTarget = null;
    smpScript = () => undefined;
    await pool.query("TRUNCATE peppol_companies CASCADE");
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  describe("bringing a participant in", () => {
    it("claims the identifier with the key instead of creating the service group", async () => {
      await seedCompany("c_in", TEAM_LAX);
      smpScript = (url) => (url.includes("/migration/inbound/") ? new Response(inboundOk) : undefined);

      const migration = await requestInboundMigration({ companyId: "c_in", identifierId: "c_in_0208", migrationKey: KEY });

      expect(migration).toMatchObject({ direction: "inbound", status: "completed", migrationKey: KEY });
      expect(smpUrls("/migration/inbound/")).toEqual([
        `https://smp.net.recommand.com/migration/inbound/iso6523-actorid-upis::0208:0123456749/${encodeURIComponent(KEY)}`,
      ]);
      // The service group came from the migration; only the business card is written afterwards.
      expect(smpRequests.map((request) => request.url)).not.toContain("https://smp.net.recommand.com/iso6523-actorid-upis::0208:0123456749");
      expect(smpUrls("/businesscard/")).toHaveLength(1);
      expect(await migrationRows("c_in")).toEqual([
        { address: "0208:0123456749", direction: "inbound", status: "completed", key: KEY, error: null },
      ]);
    });

    it("keeps the key for a company that is not publishable yet and uses it when it is", async () => {
      await seedCompany("c_wait", TEAM_STRICT, { isVerified: false });

      const migration = await requestInboundMigration({ companyId: "c_wait", identifierId: "c_wait_0208", migrationKey: KEY });
      expect(migration.status).toBe("pending");
      expect(smpRequests).toEqual([]);

      // The company passes its identity check; the registration that follows finds the key.
      await pool.query(`UPDATE peppol_companies SET is_verified = true WHERE id = 'c_wait'`);
      smpScript = (url) => (url.includes("/migration/inbound/") ? new Response(inboundOk) : undefined);
      await upsertCompanyRegistrations({ companyId: "c_wait", useTestNetwork: false });

      expect(smpUrls("/migration/inbound/")).toHaveLength(1);
      expect(await migrationRows("c_wait")).toEqual([
        { address: "0208:0123456749", direction: "inbound", status: "completed", key: KEY, error: null },
      ]);
    });

    it("records a refused key as failed with the reason and reports it", async () => {
      await seedCompany("c_refused", TEAM_LAX);
      smpScript = (url) =>
        url.includes("/migration/inbound/")
          ? new Response("Failed to confirm the migration for participant in SML, hence the migration failed.", { status: 500 })
          : undefined;

      await expect(
        requestInboundMigration({ companyId: "c_refused", identifierId: "c_refused_0208", migrationKey: KEY })
      ).rejects.toThrow("did not accept the migration key");

      const [row] = await migrationRows("c_refused");
      expect(row).toMatchObject({ status: "failed" });
      expect(row.error).toContain("did not accept the migration key");
      expect(smpUrls("/businesscard/")).toEqual([]);
    });

    it("replaces a pending key with a newer one and allows only one open migration per participant", async () => {
      await seedCompany("c_replace", TEAM_STRICT);
      await requestInboundMigration({ companyId: "c_replace", identifierId: "c_replace_0208", migrationKey: KEY });
      await requestInboundMigration({ companyId: "c_replace", identifierId: "c_replace_0208", migrationKey: OTHER_KEY });

      expect(await migrationRows("c_replace")).toEqual([
        { address: "0208:0123456749", direction: "inbound", status: "cancelled", key: KEY, error: "Replaced by a newer migration key" },
        { address: "0208:0123456749", direction: "inbound", status: "pending", key: OTHER_KEY, error: null },
      ]);
      await expect(
        pool.query(
          `INSERT INTO peppol_participant_migrations (id, company_id, scheme, identifier, direction, status, migration_key)
           VALUES ('pm_dup', 'c_replace', '0208', '0123456749', 'inbound', 'pending', 'Qq11!!ZzYy')`
        )
      ).rejects.toThrow(/peppol_participant_migrations_open_unique/);
    });

    it("takes over a new identifier when it is created with a key", async () => {
      await seedCompany("c_new", TEAM_LAX, { identifiers: [] });
      smpScript = (url) => (url.includes("/migration/inbound/") ? new Response(inboundOk) : undefined);

      await createCompanyIdentifier({
        companyIdentifier: { companyId: "c_new", scheme: "9925", identifier: "BE0123456749" },
        skipSmpRegistration: false,
        useTestNetwork: false,
        migrationKey: KEY,
      });

      expect(await identifierRows("c_new")).toEqual(["9925:be0123456749"]);
      // The SMP is addressed with the identifier as it was entered, as every registration is.
      expect(smpUrls("/migration/inbound/iso6523-actorid-upis::9925:BE0123456749/")).toHaveLength(1);
      expect(await migrationRows("c_new")).toEqual([
        { address: "9925:be0123456749", direction: "inbound", status: "completed", key: KEY, error: null },
      ]);
    });

    it("refuses keys for companies published through a partner SMP", async () => {
      await seedCompany("c_fr", TEAM_LAX, { smpProvider: "at-shared-smp-fr" });
      await expect(
        requestInboundMigration({ companyId: "c_fr", identifierId: "c_fr_0208", migrationKey: KEY })
      ).rejects.toThrow("partner SMP");
      expect(await migrationRows("c_fr")).toEqual([]);
    });
  });

  describe("letting a participant go", () => {
    it("hands out the SMP's key, waits for the network to move, then drops the identifier", async () => {
      await seedCompany("c_out", TEAM_LAX, { identifiers: [["0208", "0123456749"], ["9925", "be0123456749"]] });
      smpScript = (url) => (url.includes("/migration/outbound/start/") ? new Response(outboundOk) : undefined);

      const migration = await startOutboundMigration({ companyId: "c_out", identifierId: "c_out_0208" });
      expect(migration).toMatchObject({ direction: "outbound", status: "inProgress", migrationKey: KEY });
      expect(smpUrls("/migration/outbound/start/iso6523-actorid-upis::0208:0123456749")).toHaveLength(1);

      await expect(startOutboundMigration({ companyId: "c_out", identifierId: "c_out_0208" })).rejects.toThrow("already open");

      smlTarget = "https://smp.net.recommand.com";
      await expect(finalizeOutboundMigration({ migrationId: migration.id })).rejects.toThrow("still routes");
      expect(smpUrls("/migration/outbound/finalize/")).toEqual([]);

      smlTarget = "https://smp.other-provider.example";
      const result = await finalizeOutboundMigration({ migrationId: migration.id });
      expect(result).toMatchObject({ detached: "identifierDeleted", migration: { status: "completed" } });
      expect(smpUrls("/migration/outbound/finalize/iso6523-actorid-upis::0208:0123456749")).toHaveLength(1);
      expect(await identifierRows("c_out")).toEqual(["9925:be0123456749"]);
      // Nothing was deleted from the SMP by us: the participant now belongs to the other SMP.
      expect(smpRequests.filter((request) => request.method === "DELETE")).toEqual([]);
    });

    it("stops the company being a recipient when its only identifier leaves", async () => {
      await seedCompany("c_last", TEAM_LAX);
      smpScript = (url) => (url.includes("/migration/outbound/start/") ? new Response(outboundOk) : undefined);
      const migration = await startOutboundMigration({ companyId: "c_last", identifierId: "c_last_0208" });

      const result = await finalizeOutboundMigration({ migrationId: migration.id, force: true });
      expect(result.detached).toBe("recipientDisabled");
      expect(await identifierRows("c_last")).toEqual(["0208:0123456749"]);
      const { rows } = await pool.query(`SELECT is_smp_recipient FROM peppol_companies WHERE id = 'c_last'`);
      expect(rows[0].is_smp_recipient).toBe(false);
    });

    it("withdraws an outbound migration and lets a new one start", async () => {
      await seedCompany("c_cancel", TEAM_LAX);
      smpScript = (url) => (url.includes("/migration/outbound/start/") ? new Response(outboundOk) : undefined);
      const migration = await startOutboundMigration({ companyId: "c_cancel", identifierId: "c_cancel_0208" });

      expect((await cancelOutboundMigration(migration.id)).status).toBe("cancelled");
      expect(smpUrls("/migration/outbound/cancel/")).toHaveLength(1);
      await expect(cancelOutboundMigration(migration.id)).rejects.toThrow("not an outbound migration in progress");

      const again = await startOutboundMigration({ companyId: "c_cancel", identifierId: "c_cancel_0208" });
      expect(again.status).toBe("inProgress");
      expect((await getParticipantMigrations("c_cancel")).map((row) => row.status)).toEqual(["inProgress", "cancelled"]);
    });

    it("refuses to let go of an identifier we do not publish", async () => {
      await seedCompany("c_unpublished", TEAM_STRICT, { isVerified: false });
      await expect(startOutboundMigration({ companyId: "c_unpublished", identifierId: "c_unpublished_0208" })).rejects.toThrow(
        "nothing to migrate out"
      );
      expect(smpRequests).toEqual([]);
    });
  });
});
