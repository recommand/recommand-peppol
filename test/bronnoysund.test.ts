import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BronnoysundUnavailableError,
  fetchDeletedOrganisations,
  lookupOrganisation,
} from "@peppol/data/bronnoysund/client";
import { assertNorwegianOrganisationsRegistrable } from "@peppol/data/bronnoysund/organisation-check";
import { assertIdentifiersRegistrable } from "@peppol/data/identifier-registration-checks";
import type { RegisteredNorwegianIdentifier } from "@peppol/data/bronnoysund/deleted-organisations";

// The sweep is tested through its dependencies; the database is never reached.
mock.module("@recommand/db", () => ({ db: {} }));
const { sweepDeletedNorwegianOrganisations } = await import("@peppol/data/bronnoysund/deleted-organisations");

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "bronnoysund", name), "utf8"));

type Route = (url: URL) => Response | Promise<Response>;

/** A fetch that answers from the given routes by path and records every request. */
function fakeBrreg(routes: Record<string, Route>) {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(`${url.pathname}${url.search}`);
    const route = routes[url.pathname];
    return route ? route(url) : new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests, retryDelaysMs: [0, 0] };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("looking up a Norwegian organisation", () => {
  it("reports an active main entity", async () => {
    const brreg = fakeBrreg({ "/enhetsregisteret/api/enheter/923609016": () => json(fixture("enhet-active.json")) });
    expect(await lookupOrganisation("923609016", brreg)).toEqual({
      status: "active",
      organisationNumber: "923609016",
      name: "NORDLYS HANDEL AS",
    });
  });

  it("reports a deleted entity, which the register still serves with its deletion date", async () => {
    const brreg = fakeBrreg({ "/enhetsregisteret/api/enheter/927373122": () => json(fixture("enhet-deleted.json")) });
    expect(await lookupOrganisation("927373122", brreg)).toEqual({
      status: "deleted",
      organisationNumber: "927373122",
      name: "KLUBBSTYRE FJORDHUS",
      deletedOn: "2026-10-08",
    });
  });

  it("falls back to the sub-unit register", async () => {
    const brreg = fakeBrreg({ "/enhetsregisteret/api/underenheter/974760673": () => json(fixture("underenhet-active.json")) });
    expect(await lookupOrganisation("974760673", brreg)).toMatchObject({ status: "active", name: "NORDLYS HANDEL AS AVD BERGEN" });
    expect(brreg.requests).toEqual([
      "/enhetsregisteret/api/enheter/974760673",
      "/enhetsregisteret/api/underenheter/974760673",
    ]);
  });

  it("reports a number neither register knows", async () => {
    const brreg = fakeBrreg({});
    expect(await lookupOrganisation("123456785", brreg)).toEqual({ status: "notFound", organisationNumber: "123456785" });
  });

  it("retries server errors and then reports the register unavailable", async () => {
    const brreg = fakeBrreg({ "/enhetsregisteret/api/enheter/923609016": () => new Response("busy", { status: 503 }) });
    await expect(lookupOrganisation("923609016", brreg)).rejects.toBeInstanceOf(BronnoysundUnavailableError);
    expect(brreg.requests).toHaveLength(3);
  });

  it("does not retry a client error", async () => {
    const brreg = fakeBrreg({ "/enhetsregisteret/api/enheter/923609016": () => new Response("bad", { status: 400 }) });
    await expect(lookupOrganisation("923609016", brreg)).rejects.toBeInstanceOf(BronnoysundUnavailableError);
    expect(brreg.requests).toHaveLength(1);
  });

  it("recovers when a retry succeeds", async () => {
    let calls = 0;
    const brreg = fakeBrreg({
      "/enhetsregisteret/api/enheter/923609016": () => (++calls === 1 ? new Response("", { status: 502 }) : json(fixture("enhet-active.json"))),
    });
    expect((await lookupOrganisation("923609016", brreg)).status).toBe("active");
  });
});

describe("reading deletions from the change feed", () => {
  it("keeps deletions and removals from both registers and pages by update id", async () => {
    const brreg = fakeBrreg({
      "/enhetsregisteret/api/oppdateringer/enheter": (url) =>
        json(fixture(url.searchParams.has("oppdateringsid") ? "oppdateringer-enheter-page2.json" : "oppdateringer-enheter-page1.json")),
      "/enhetsregisteret/api/oppdateringer/underenheter": () => json(fixture("oppdateringer-underenheter.json")),
    });
    const deleted = await fetchDeletedOrganisations(new Date("2026-10-08T00:00:00.000Z"), { ...brreg, feedPageSize: 3 });

    expect(deleted).toEqual([
      { organisationNumber: "927373122", deletedAt: "2026-10-08T00:45:10.847Z" },
      { organisationNumber: "980328449", deletedAt: "2026-10-08T04:05:15.899Z" },
      { organisationNumber: "974760673", deletedAt: "2026-10-08T03:25:10.711Z" },
    ]);
    expect(brreg.requests).toEqual([
      "/enhetsregisteret/api/oppdateringer/enheter?dato=2026-10-08T00%3A00%3A00.000Z&size=3",
      "/enhetsregisteret/api/oppdateringer/enheter?oppdateringsid=25308474&size=3",
      "/enhetsregisteret/api/oppdateringer/underenheter?dato=2026-10-08T00%3A00%3A00.000Z&size=3",
    ]);
  });
});

describe("registering a Norwegian organisation number", () => {
  const routes = {
    "/enhetsregisteret/api/enheter/923609016": () => json(fixture("enhet-active.json")),
    "/enhetsregisteret/api/enheter/927373122": () => json(fixture("enhet-deleted.json")),
  };

  it("accepts an active organisation and ignores other schemes", async () => {
    const brreg = fakeBrreg(routes);
    await assertNorwegianOrganisationsRegistrable(
      [{ scheme: "0192", identifier: "923609016" }, { scheme: "0208", identifier: "0123456749" }],
      brreg
    );
    expect(brreg.requests).toEqual(["/enhetsregisteret/api/enheter/923609016"]);
  });

  it("refuses a number the register does not know", async () => {
    await expect(
      assertNorwegianOrganisationsRegistrable([{ scheme: "0192", identifier: "123456785" }], fakeBrreg(routes))
    ).rejects.toThrow("Organisation number 123456785 is not registered in Enhetsregisteret");
  });

  it("refuses a deleted organisation and says when it was deleted", async () => {
    await expect(
      assertNorwegianOrganisationsRegistrable([{ scheme: "0192", identifier: "927373122" }], fakeBrreg(routes))
    ).rejects.toThrow("was deleted from Enhetsregisteret, the Norwegian register of legal entities, on 2026-10-08");
  });

  it("lets the registration through when the register is unreachable, and alerts support", async () => {
    const alerts: string[] = [];
    const brreg = fakeBrreg({ "/enhetsregisteret/api/enheter/923609016": () => new Response("", { status: 503 }) });
    await assertNorwegianOrganisationsRegistrable([{ scheme: "0192", identifier: "923609016" }], {
      ...brreg,
      alert: async (title, message) => { alerts.push(`${title}: ${message}`); },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("0192:923609016 was registered without checking");
  });
});

describe("checks before an identifier is published", () => {
  it("hands each scheme's check only its own identifiers and leaves other schemes alone", async () => {
    const calls: string[] = [];
    await assertIdentifiersRegistrable(
      [
        { scheme: "0192", identifier: "923609016" },
        { scheme: "0208", identifier: "0123456749" },
        { scheme: "0192", identifier: "974760673" },
      ],
      { "0192": async (identifiers) => { calls.push(identifiers.map((identifier) => identifier.identifier).join(",")); } }
    );
    expect(calls).toEqual(["923609016,974760673"]);
  });

  it("checks nothing for identifiers without a register check", async () => {
    await assertIdentifiersRegistrable([{ scheme: "0208", identifier: "0123456749" }]);
  });
});

describe("the daily sweep of deleted organisations", () => {
  const registration = (identifier: string): RegisteredNorwegianIdentifier => ({
    identifierId: `ci_${identifier}`,
    identifier,
    companyId: `c_${identifier}`,
    companyName: `Company ${identifier}`,
    teamId: "team_1",
    useTestNetwork: false,
  });

  it("reads three days back, deregisters each published match and tells the team", async () => {
    const calls: string[] = [];
    const alerts: string[] = [];
    let since: Date | undefined;
    const result = await sweepDeletedNorwegianOrganisations(new Date("2026-10-09T05:30:00.000Z"), {
      fetchDeleted: async (from) => {
        since = from;
        return [
          { organisationNumber: "927373122", deletedAt: "2026-10-08T00:45:10.847Z" },
          { organisationNumber: "980328449", deletedAt: "2026-10-08T04:05:15.899Z" },
        ];
      },
      findRegistered: async (numbers) => {
        calls.push(`find ${numbers.join(",")}`);
        return [registration("927373122")];
      },
      deregister: async (match) => { calls.push(`deregister ${match.identifierId}`); },
      notifyTeam: async (match, deletion) => { calls.push(`notify ${match.teamId} ${deletion.deletedAt}`); },
      alert: async (title) => { alerts.push(title); },
    });

    expect(since?.toISOString()).toBe("2026-10-06T05:30:00.000Z");
    expect(calls).toEqual([
      "find 927373122,980328449",
      "deregister ci_927373122",
      "notify team_1 2026-10-08T00:45:10.847Z",
    ]);
    expect(result.deregistered.map((match) => match.identifier)).toEqual(["927373122"]);
    expect(alerts).toEqual(["Deleted Norwegian Organisations Deregistered"]);
  });

  it("does not look up registrations when nothing was deleted", async () => {
    const result = await sweepDeletedNorwegianOrganisations(new Date(), {
      fetchDeleted: async () => [],
      findRegistered: async () => { throw new Error("must not be called"); },
      deregister: async () => {},
      notifyTeam: async () => {},
      alert: async () => { throw new Error("must not alert"); },
    });
    expect(result).toEqual({ deletionsRead: 0, deregistered: [], failed: [] });
  });

  it("carries on past a failed deregistration and reports it without notifying the team", async () => {
    const notified: string[] = [];
    const alerts: string[] = [];
    const result = await sweepDeletedNorwegianOrganisations(new Date(), {
      fetchDeleted: async () => [
        { organisationNumber: "927373122", deletedAt: "2026-10-08T00:45:10.847Z" },
        { organisationNumber: "974760673", deletedAt: "2026-10-08T03:25:10.711Z" },
      ],
      findRegistered: async () => [registration("927373122"), registration("974760673")],
      deregister: async (match) => {
        if (match.identifier === "927373122") throw new Error("SMP unavailable");
      },
      notifyTeam: async (match) => { notified.push(match.identifier); },
      alert: async (title, message) => { alerts.push(`${title}: ${message}`); },
    });

    expect(notified).toEqual(["974760673"]);
    expect(result.failed).toEqual([{ registration: registration("927373122"), error: "SMP unavailable" }]);
    expect(alerts.map((alert) => alert.split(":")[0])).toEqual([
      "Deleted Norwegian Organisations Deregistered",
      "Deleted Norwegian Organisations Not Deregistered",
    ]);
  });
});
