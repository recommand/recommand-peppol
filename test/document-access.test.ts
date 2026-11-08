import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Hono } from "hono";
import type { Company } from "@peppol/data/companies";
import type { ExtendedTeam } from "@peppol/data/teams";

// A team without access to its documents cannot reach them: the documents API
// refuses it, apart from labelling them, and the emails that can attach a document
// are not sent.

process.env.JWT_SECRET ??= "test_secret";

mock.module("@recommand/db", () => ({ db: {} }));
const companies = await import("@peppol/data/companies");
const teams = await import("@peppol/data/teams");
const notificationAddresses = await import("@peppol/data/company-notification-emails");
const entitlements = await import("@peppol/lib/entitlements");
const { sendIncomingDocumentNotifications } = await import("@peppol/data/send-document-notifications");
const { requireDocumentAccess } = await import("@peppol/utils/auth-middleware");
const { buildPeppolDocumentEmailAttachments } = await import("@peppol/data/email/document-notification-props");

const companySpy = spyOn(companies, "getCompanyById").mockResolvedValue({ id: "c_receiver", teamId: "team_receiver", name: "Receiver" } as Company);
const teamSpy = spyOn(teams, "getExtendedTeam").mockResolvedValue({ id: "team_receiver", name: "Receiver", isPlayground: false } as ExtendedTeam);
const addressesSpy = spyOn(notificationAddresses, "getIncomingCompanyNotificationEmailAddresses").mockResolvedValue([]);

let hasAccess = false;
const asked: string[] = [];
entitlements.registerEntitlementResolver(async (teamId, entitlementId) => {
  asked.push(`${teamId}:${entitlementId}`);
  return hasAccess ? { allowed: true } : { allowed: false, message: "Team {teamName} cannot access its documents" };
});

afterAll(() => {
  entitlements.clearEntitlementResolver();
  companySpy.mockRestore();
  teamSpy.mockRestore();
  addressesSpy.mockRestore();
});

beforeEach(() => {
  asked.length = 0;
  addressesSpy.mockClear();
});

const notification = {
  transmittedDocumentId: "doc_1",
  companyId: "c_receiver",
  companyName: "Receiver",
  type: "invoice",
  parsedDocument: null,
  xmlDocument: "<Invoice />",
  isPlayground: false,
} as Parameters<typeof sendIncomingDocumentNotifications>[0];

describe("incoming document emails", () => {
  it("are not sent to a team without document access", async () => {
    hasAccess = false;
    expect(await sendIncomingDocumentNotifications(notification)).toEqual([]);
    expect(asked).toEqual(["team_receiver:peppol.document-access"]);
    expect(addressesSpy).not.toHaveBeenCalled();
  });

  it("go on as usual for a team with document access", async () => {
    hasAccess = true;
    await sendIncomingDocumentNotifications(notification);
    expect(addressesSpy).toHaveBeenCalledTimes(1);
  });
});

describe("rule emails", () => {
  const event = {
    id: "ev_1", type: "peppol.document.label.assigned.v1", teamId: "team_receiver", aggregateType: "peppol.document",
    aggregateId: "doc_1", correlationId: null, idempotencyKey: "ev_1", payload: {}, createdAt: new Date().toISOString(),
  };

  it("leave out the document for a team without document access", async () => {
    hasAccess = false;
    // The test's database has no document to read, so reaching it would throw.
    expect(await buildPeppolDocumentEmailAttachments(event, { xmlDocument: true })).toEqual([]);
    expect(asked).toEqual(["team_receiver:peppol.document-access"]);
  });
});

describe("the documents API", () => {
  function appForTeam() {
    const app = new Hono();
    app.use(async (c, next) => {
      c.set("team" as never, { id: "team_receiver", name: "Receiver" } as never);
      await next();
    });
    app.get("/documents", requireDocumentAccess() as never, (c) => c.json({ success: true }));
    return app;
  }

  it("refuses a team without document access, with what it is told to do", async () => {
    hasAccess = false;
    const response = await appForTeam().request("/documents");
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).toContain("Team Receiver cannot access its documents");
  });

  it("lets a team with document access through", async () => {
    hasAccess = true;
    expect((await appForTeam().request("/documents")).status).toBe(200);
  });

  it("guards every route right after its team access, except labelling", () => {
    const directory = join(import.meta.dir, "..", "api", "documents");
    const labelling = ["assign-label.ts", "bulk-assign-label.ts", "unassign-label.ts"];
    const routeFiles = readdirSync(directory).filter((file) => /server\.(get|post|put|patch|delete)\(/.test(readFileSync(join(directory, file), "utf8")));
    expect(routeFiles.length).toBeGreaterThan(10);
    for (const file of routeFiles) {
      const source = readFileSync(join(directory, file), "utf8");
      const routes = source.match(/server\.(get|post|put|patch|delete)\(/g)!.length;
      const guarded = source.match(/require(IntegrationSupported)?TeamAccess\(\),\s*requireDocumentAccess\(\),/g)?.length ?? 0;
      expect(`${file}: ${guarded}`).toBe(`${file}: ${labelling.includes(file) ? 0 : routes}`);
    }
  });
});
