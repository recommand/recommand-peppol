import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// A playground that is not on the Peppol Test Network answers a recipient the way
// production would and leaves out only the delivery. Its own companies are laid over
// the production network: an address that belongs to one of them is answered from that
// company's registrations, read fresh from the database, and any other address from the
// production SMP. Asserted against a real PostgreSQL, because which company an address
// resolves to, and in which team, is a query.

const BIS3_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const SELF_BILLING_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1";
const BILLING_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const SELF_BILLING_PROCESS = "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0";

const PLAYGROUND = "team_playground";
const OTHER_PLAYGROUND = "team_other_playground";

// An address that is a company in the playground and a real participant at once: the
// playground company wins.
const PLAYGROUND_RECIPIENT = "0208:0654840070";
// A company in another playground team, which this playground knows nothing of.
const OTHER_TEAMS_RECIPIENT = "0208:0123456749";
// A participant on the production network only.
const PRODUCTION_RECIPIENT = "0208:0987654321";

const deliveries: { receiverId: string; docTypeId: string }[] = [];
const smpRequests: string[] = [];
let pool: Pool;
let getRecipientCapabilities: typeof import("../../data/recipient-capabilities").getRecipientCapabilities;
let simulate: typeof import("../../data/playground/simulate-ap");
let resolvePlaygroundAddress: typeof import("../../data/playground/recipients").resolvePlaygroundAddress;

/** The production SMP: every participant registered for self-billing invoices only. */
const productionParticipants = new Set([PLAYGROUND_RECIPIENT, OTHER_TEAMS_RECIPIENT, PRODUCTION_RECIPIENT]);

function smpResponse(url: string): Response {
  const decoded = decodeURIComponent(url);
  const participant = decoded.match(/iso6523-actorid-upis::([^/]+)/)?.[1];
  if (!participant || !productionParticipants.has(participant)) {
    return new Response("Not found", { status: 404 });
  }
  if (decoded.includes("/services/")) {
    return new Response(`
      <ServiceMetadata><ServiceInformation><ProcessList><Process>
        <ProcessIdentifier scheme="cenbii-procid-ubl">${SELF_BILLING_PROCESS}</ProcessIdentifier>
        <ServiceEndpointList><Endpoint><EndpointReference><Address>https://ap.example/as4</Address></EndpointReference></Endpoint></ServiceEndpointList>
      </Process></ProcessList></ServiceInformation></ServiceMetadata>`);
  }
  const reference = `https://smp.example/iso6523-actorid-upis%3A%3A${encodeURIComponent(participant)}/services/busdox-docid-qns%3A%3A${encodeURIComponent(SELF_BILLING_INVOICE)}`;
  return new Response(`
    <ServiceGroup><ServiceMetadataReferenceCollection>
      <ServiceMetadataReference href="${reference}"/>
    </ServiceMetadataReferenceCollection></ServiceGroup>`);
}

async function seedPlaygroundTeam(id: string) {
  await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1)`, [id]);
  await pool.query(
    `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network) VALUES ($1, true, false)`,
    [id]
  );
}

async function seedCompany(id: string, teamId: string, address: string, options: { isSmpRecipient?: boolean } = {}) {
  const [scheme, identifier] = address.split(":");
  await pool.query(
    `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number, is_smp_recipient, access_point_provider, smp_provider)
     VALUES ($1, $2, 'Example BV', 'Straat 1', '9000', 'Gent', 'BE', $3, $4, 'recommand-ap1', 'recommand-smp1')`,
    [id, teamId, identifier, options.isSmpRecipient ?? true]
  );
  await pool.query(
    `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ($1 || '_id', $1, $2, $3)`,
    [id, scheme, identifier]
  );
}

async function register(companyId: string, docTypeId: string, processId: string) {
  await pool.query(
    `INSERT INTO peppol_company_document_types (id, company_id, doc_type_id, process_id) VALUES ('cdt_' || md5(random()::text), $1, $2, $3)`,
    [companyId, docTypeId, processId]
  );
}

function lookup(recipientAddress: string) {
  return getRecipientCapabilities({ recipientAddress, isPlayground: true, useTestNetwork: false, teamId: PLAYGROUND });
}

function send(receiverId: string, docTypeId: string, processId: string) {
  return simulate.simulateSendAs4({
    senderId: "0208:0111111111",
    receiverId,
    docTypeId,
    processId,
    countryC1: "BE",
    body: "<Invoice/>",
    playgroundTeamId: PLAYGROUND,
  });
}

describe.skipIf(!testDatabaseUrl)("playground recipients against PostgreSQL", () => {
  const fetchMock = spyOn(globalThis, "fetch");

  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/naptr", () => ({
      resolveNaptr: async () => ({ status: "found", smpUrl: "https://smp.example" }),
      smlResolver: {},
    }));
    mock.module("@peppol/utils/pipelines/receiving", () => ({
      receivingPipeline: async (options: { receiverId: string; docTypeId: string }) => {
        deliveries.push({ receiverId: options.receiverId, docTypeId: options.docTypeId });
      },
    }));
    fetchMock.mockImplementation(
      Object.assign(
        async (input: URL | RequestInfo) => {
          smpRequests.push(String(input));
          return smpResponse(String(input));
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    ({ getRecipientCapabilities } = await import("../../data/recipient-capabilities"));
    simulate = await import("../../data/playground/simulate-ap");
    ({ resolvePlaygroundAddress } = await import("../../data/playground/recipients"));
    await seedPlaygroundTeam(PLAYGROUND);
    await seedPlaygroundTeam(OTHER_PLAYGROUND);
  });

  afterAll(async () => {
    fetchMock.mockRestore();
    await pool?.end();
  });

  beforeEach(async () => {
    deliveries.length = 0;
    smpRequests.length = 0;
    await pool.query("TRUNCATE peppol_companies CASCADE");
    await seedCompany("c_playground", PLAYGROUND, PLAYGROUND_RECIPIENT);
    await register("c_playground", BIS3_INVOICE, BILLING_PROCESS);
    await seedCompany("c_other_team", OTHER_PLAYGROUND, OTHER_TEAMS_RECIPIENT);
    await register("c_other_team", BIS3_INVOICE, BILLING_PROCESS);
  });

  describe("resolving an address", () => {
    // What both verify endpoints answer from, before they fall through to the network.
    const resolve = (recipientAddress: string) =>
      resolvePlaygroundAddress({ recipientAddress, playgroundTeamId: PLAYGROUND });

    it("resolves a playground company to its registrations", async () => {
      const resolved = await resolve(PLAYGROUND_RECIPIENT);
      expect(resolved?.kind).toBe("company");
      expect(resolved?.kind === "company" && resolved.recipient.registrations).toEqual([
        { docTypeId: BIS3_INVOICE, processId: BILLING_PROCESS },
      ]);
    });

    it("leaves another team's company and any other address to the network", async () => {
      expect(await resolve(OTHER_TEAMS_RECIPIENT)).toBeNull();
      expect(await resolve(PRODUCTION_RECIPIENT)).toBeNull();
    });

    it("treats the reserved addresses and a malformed one as unknown", async () => {
      expect(await resolve("404:404")).toEqual({ kind: "unknown" });
      expect(await resolve("0208:")).toEqual({ kind: "unknown" });
    });
  });

  describe("looking a recipient up", () => {
    it("answers a playground company from its registrations, not from the production SMP", async () => {
      const capabilities = await lookup(PLAYGROUND_RECIPIENT);
      expect(capabilities?.supportsDocType(BIS3_INVOICE)).toBe(true);
      expect(capabilities?.supportsDocType(SELF_BILLING_INVOICE)).toBe(false);
      expect(smpRequests).toEqual([]);
    });

    it("sees a registration added in the playground on the next lookup", async () => {
      expect((await lookup(PLAYGROUND_RECIPIENT))?.supportsDocType(SELF_BILLING_INVOICE)).toBe(false);
      await register("c_playground", SELF_BILLING_INVOICE, SELF_BILLING_PROCESS);
      expect((await lookup(PLAYGROUND_RECIPIENT))?.supportsDocType(SELF_BILLING_INVOICE)).toBe(true);
    });

    it("compares registrations stored with their identifier schemes", async () => {
      await register("c_playground", `busdox-docid-qns::${SELF_BILLING_INVOICE}`, `cenbii-procid-ubl::${SELF_BILLING_PROCESS}`);
      const capabilities = await lookup(PLAYGROUND_RECIPIENT);
      expect(await capabilities?.getProcessIds(SELF_BILLING_INVOICE)).toEqual([SELF_BILLING_PROCESS]);
    });

    it("answers any other address from the production SMP, including another team's playground company", async () => {
      const capabilities = await lookup(OTHER_TEAMS_RECIPIENT);
      expect(capabilities?.supportsDocType(SELF_BILLING_INVOICE)).toBe(true);
      expect(capabilities?.supportsDocType(BIS3_INVOICE)).toBe(false);
      expect(smpRequests.length).toBeGreaterThan(0);
    });

    it("answers a company that only sends from the production SMP", async () => {
      await pool.query(`UPDATE peppol_companies SET is_smp_recipient = false WHERE id = 'c_playground'`);
      const capabilities = await lookup(PLAYGROUND_RECIPIENT);
      expect(capabilities?.supportsDocType(SELF_BILLING_INVOICE)).toBe(true);
    });

    it("knows nothing about the addresses reserved for an unknown participant", async () => {
      expect(await lookup("404:404")).toBeNull();
      expect(await lookup("0208:1234567894")).toBeNull();
      expect(smpRequests).toEqual([]);
    });
  });

  describe("simulating a send", () => {
    it("delivers to a playground company registered for the document type and process", async () => {
      await send(PLAYGROUND_RECIPIENT, BIS3_INVOICE, BILLING_PROCESS);
      expect(deliveries).toEqual([{ receiverId: PLAYGROUND_RECIPIENT, docTypeId: BIS3_INVOICE }]);
    });

    it("refuses a document type the playground company is not registered for, though production would take it", async () => {
      await expect(send(PLAYGROUND_RECIPIENT, SELF_BILLING_INVOICE, SELF_BILLING_PROCESS)).rejects.toBeInstanceOf(
        simulate.PlaygroundDocumentNotSupportedError,
      );
      expect(deliveries).toEqual([]);
    });

    it("refuses a process the playground company did not register the document type under", async () => {
      await expect(send(PLAYGROUND_RECIPIENT, BIS3_INVOICE, SELF_BILLING_PROCESS)).rejects.toBeInstanceOf(
        simulate.PlaygroundDocumentNotSupportedError,
      );
    });

    it("accepts a production participant registered for the document type, and delivers nothing", async () => {
      await send(PRODUCTION_RECIPIENT, SELF_BILLING_INVOICE, `cenbii-procid-ubl::${SELF_BILLING_PROCESS}`);
      expect(deliveries).toEqual([]);
    });

    it("refuses a document type a production participant is not registered for", async () => {
      await expect(send(PRODUCTION_RECIPIENT, BIS3_INVOICE, BILLING_PROCESS)).rejects.toBeInstanceOf(
        simulate.PlaygroundDocumentNotSupportedError,
      );
    });

    it("reports an address no playground company and no production participant answers to as not found", async () => {
      await expect(send("0208:0555555555", BIS3_INVOICE, BILLING_PROCESS)).rejects.toBeInstanceOf(
        simulate.PlaygroundRecipientNotFoundError,
      );
    });

    it("reports a malformed address as not found", async () => {
      await expect(send("0208:", BIS3_INVOICE, BILLING_PROCESS)).rejects.toBeInstanceOf(
        simulate.PlaygroundRecipientNotFoundError,
      );
    });

    it("keeps failing the reserved addresses", async () => {
      await expect(send("404:404", BIS3_INVOICE, BILLING_PROCESS)).rejects.toBeInstanceOf(
        simulate.PlaygroundRecipientNotFoundError,
      );
    });
  });
});
