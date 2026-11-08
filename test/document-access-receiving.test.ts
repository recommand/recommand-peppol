import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Company } from "@peppol/data/companies";
import type { ExtendedTeam } from "@peppol/data/teams";

// A team without access to its documents still receives them, so nothing sent to it
// is lost, but no event announces them.

const stored: { id: string }[] = [];
mock.module("@recommand/db", () => ({
  db: {
    insert: () => ({
      values: (values: { id: string }) => {
        stored.push(values);
        return { returning: async () => [{ id: values.id }] };
      },
    }),
  },
}));
const companies = await import("@peppol/data/companies");
const teams = await import("@peppol/data/teams");
const preparing = await import("@peppol/utils/pipelines/receiving/prepare-document");
const validation = await import("@peppol/data/validation/client");
const events = await import("@core/data/rules/events");
const usage = await import("@peppol/data/usage");
const suppliers = await import("@peppol/data/suppliers");
const notifications = await import("@peppol/data/send-document-notifications");
const entitlements = await import("@peppol/lib/entitlements");
const { receivingPipeline } = await import("@peppol/utils/pipelines/receiving");

const spies = [
  spyOn(companies, "getCompanyByPeppolId").mockResolvedValue({ id: "c_receiver", teamId: "team_receiver", name: "Receiver" } as Company),
  spyOn(teams, "getExtendedTeam").mockResolvedValue({ id: "team_receiver", name: "Receiver", isPlayground: false } as ExtendedTeam),
  spyOn(preparing, "prepareIncomingDocument").mockResolvedValue({
    type: "invoice", probableType: "invoice", parsedDocument: { seller: { vatNumber: "BE0123456789" } },
    xmlDocument: "<Invoice />", documentType: null, originalPayload: null,
  } as never),
  spyOn(validation, "validateXmlDocument").mockResolvedValue({ result: "valid", errors: [] } as never),
  spyOn(suppliers, "findSupplierByVatAndPeppolId").mockResolvedValue(null as never),
  spyOn(notifications, "sendIncomingDocumentNotifications").mockResolvedValue([]),
];
const publishSpy = spyOn(events, "publishEvent").mockResolvedValue(undefined as never);
const usageSpy = spyOn(usage, "recordUsageEvents").mockResolvedValue(undefined as never);

let hasAccess = false;
entitlements.registerEntitlementResolver(async () => ({ allowed: hasAccess }));

afterAll(() => {
  entitlements.clearEntitlementResolver();
  for (const spy of [...spies, publishSpy, usageSpy]) spy.mockRestore();
});

beforeEach(() => {
  stored.length = 0;
  publishSpy.mockClear();
  usageSpy.mockClear();
});

const input = {
  senderId: "iso6523-actorid-upis::0208:0123456789",
  receiverId: "iso6523-actorid-upis::0208:9876543210",
  docTypeId: "doc",
  processId: "process",
  countryC1: "BE",
  body: "<Invoice />",
  useTestNetwork: false,
};

describe("receiving a document", () => {
  it("stores and counts it without an event for a team without document access", async () => {
    hasAccess = false;
    await receivingPipeline(input);
    expect(stored).toHaveLength(1);
    expect(usageSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("publishes the event for a team with document access", async () => {
    hasAccess = true;
    await receivingPipeline(input);
    expect(stored).toHaveLength(1);
    expect(publishSpy.mock.calls[0][0]).toBe("peppol.document.received.v1");
  });
});
