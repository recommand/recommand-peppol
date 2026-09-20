import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  cancelOutboundMigration,
  finalizeOutboundMigration,
  migrateInbound,
  startOutboundMigration,
} from "../data/phoss-smp/migration";
import { isRecommandSmpUrl } from "../data/phoss-smp/client";

// The phoss SMP does the SML work; what we own is the request we send it and how
// its answers are read. These tests replace fetch and assert on both.

const fetchMock = spyOn(globalThis, "fetch");
const requests: { url: string; method?: string }[] = [];

function respondWith(status: number, body: string) {
  fetchMock.mockImplementation(
    Object.assign(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), method: init?.method });
        return new Response(body, { status });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
}

const ref = { peppolIdentifierEas: "0208", peppolIdentifierAddress: "0123456749", useTestNetwork: false };

afterEach(() => {
  fetchMock.mockReset();
  requests.length = 0;
});

afterAll(() => {
  fetchMock.mockRestore();
});

describe("starting an outbound migration", () => {
  it("reads the key the SMP created and asks the production SMP for it", async () => {
    respondWith(200, `<?xml version="1.0"?><migrationOutboundResponse success="true"><participantID>iso6523-actorid-upis::0208:0123456749</participantID><migrationKey>Ab12$#xyZ9!kLm</migrationKey></migrationOutboundResponse>`);
    const result = await startOutboundMigration(ref);
    expect(result.migrationKey).toBe("Ab12$#xyZ9!kLm");
    expect(requests).toEqual([
      { url: "https://smp.net.recommand.com/migration/outbound/start/iso6523-actorid-upis::0208:0123456749", method: "PUT" },
    ]);
  });

  it("keeps a key that looks like a number as text", async () => {
    respondWith(200, `<migrationOutboundResponse success="true"><migrationKey>12345678</migrationKey></migrationOutboundResponse>`);
    expect((await startOutboundMigration(ref)).migrationKey).toBe("12345678");
  });

  it("explains an already running migration", async () => {
    respondWith(400, "The outbound Participant Migration of the Service Group 'iso6523-actorid-upis::0208:0123456749' is already in progress");
    await expect(startOutboundMigration(ref)).rejects.toThrow("already in progress");
  });

  it("explains a participant we do not publish", async () => {
    respondWith(400, "The Service Group 'iso6523-actorid-upis::0208:0123456749' does not exist");
    await expect(startOutboundMigration(ref)).rejects.toThrow("not registered on Recommand's SMP");
  });

  it("uses the test SMP for the test network", async () => {
    respondWith(200, `<migrationOutboundResponse success="true"><migrationKey>Ab12$#xyZ9!kLm</migrationKey></migrationOutboundResponse>`);
    await startOutboundMigration({ ...ref, useTestNetwork: true });
    expect(requests[0].url.startsWith("https://test-smp.net.recommand.com/")).toBe(true);
  });
});

describe("closing an outbound migration", () => {
  it("reports a cancel of a migration the SMP no longer has as nothing to do", async () => {
    respondWith(400, "Failed to resolve outbound Participant Migration for Service Group ID 'iso6523-actorid-upis::0208:0123456749'");
    expect(await cancelOutboundMigration(ref)).toBe(false);
    expect(requests[0].url).toEndWith("/migration/outbound/cancel/iso6523-actorid-upis::0208:0123456749");
  });

  it("finalizes and treats an already finalized migration as done", async () => {
    respondWith(200, "");
    expect(await finalizeOutboundMigration(ref)).toBe(true);
    respondWith(400, "The participant migration with ID 'x' is already finalized");
    expect(await finalizeOutboundMigration(ref)).toBe(false);
  });

  it("fails loudly on any other SMP error", async () => {
    respondWith(500, "boom");
    await expect(finalizeOutboundMigration(ref)).rejects.toThrow("Failed to finalize");
  });
});

describe("claiming a participant inbound", () => {
  it("sends the key URL-encoded in the path and reports success", async () => {
    respondWith(200, `<migrationInboundResponse success="true" serviceGroupCreated="true" migrationCreated="true" />`);
    const outcome = await migrateInbound({ ...ref, migrationKey: "Ab12$#xyZ9!kLm" });
    expect(outcome).toBe("migrated");
    expect(requests[0]).toEqual({
      url: "https://smp.net.recommand.com/migration/inbound/iso6523-actorid-upis::0208:0123456749/Ab12%24%23xyZ9!kLm",
      method: "PUT",
    });
  });

  it("reports a participant we already publish instead of failing", async () => {
    respondWith(400, "The Service Group 'iso6523-actorid-upis::0208:0123456749' already exists.");
    expect(await migrateInbound({ ...ref, migrationKey: "Ab12$#xyZ9!kLm" })).toBe("alreadyOnThisSmp");
  });

  it("turns an SML refusal into advice about the key", async () => {
    respondWith(500, "Failed to confirm the migration for participant '0208:0123456749' in SML, hence the migration failed.");
    await expect(migrateInbound({ ...ref, migrationKey: "Ab12$#xyZ9!kLm" })).rejects.toThrow("did not accept the migration key");
  });

  it("asks for support when the SML moved the participant but the SMP could not store it", async () => {
    respondWith(200, `<migrationInboundResponse success="false" serviceGroupCreated="false" migrationCreated="true" />`);
    await expect(migrateInbound({ ...ref, migrationKey: "Ab12$#xyZ9!kLm" })).rejects.toThrow("support@recommand.eu");
  });
});

describe("recognising our own SMP", () => {
  it("matches the SMP URL the SML resolves for us and nothing else", () => {
    expect(isRecommandSmpUrl("https://smp.net.recommand.com/iso6523-actorid-upis::0208:1", false)).toBe(true);
    expect(isRecommandSmpUrl("https://test-smp.net.recommand.com/x", true)).toBe(true);
    expect(isRecommandSmpUrl("https://test-smp.net.recommand.com/x", false)).toBe(false);
    expect(isRecommandSmpUrl("http://B-abc.iso6523-actorid-upis.participant.sml.prod.tech.peppol.org/x", false)).toBe(false);
    expect(isRecommandSmpUrl("not a url", false)).toBe(false);
  });
});
