import { describe, expect, it, mock } from "bun:test";
import type { DocumentDelivery } from "../../data/deliveries/model";
import type { documentDeliveries } from "../../db/schema";

// Recording a document is exercised against fakes of everything it writes to, so
// the shape of what it returns can be asserted without a database. The point under
// test is the read-back of the deliveries after the staging step.

let deliveries: DocumentDelivery[] = [];
let stagedOutcome: () => Promise<string> = async () => "unchanged";
const events: string[] = [];

mock.module("@recommand/db", () => ({
  db: {
    transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        insert: () => ({
          values: (row: { id: string }) => ({ returning: async () => [{ id: row.id }] }),
        }),
      }),
    insert: () => ({ values: async () => {} }),
  },
}));
mock.module("@core/lib/audit", () => ({
  audit: async () => {},
  writeAuditEvent: async () => {},
}));
mock.module("@core/data/rules/events", () => ({
  publishEvent: async (type: string) => {
    events.push(type);
  },
}));
mock.module("@peppol/data/offload/storage", () => ({
  uploadDocumentOriginalPayload: async () => "prefix",
  parsedHasAttachments: () => false,
}));
mock.module("@peppol/data/send-document-notifications", () => ({
  sendOutgoingDocumentNotifications: async () => {},
}));
mock.module("@peppol/utils/system-notifications/telegram", () => ({
  sendSystemAlert: async () => {},
}));
const model = await import("../../data/deliveries/model");
mock.module("@peppol/data/deliveries", () => ({
  ...model,
  insertDocumentDeliveries: async (_tx: unknown, rows: (typeof documentDeliveries.$inferInsert)[]) => {
    deliveries = rows.map((row, index) => ({
      providerEventId: null,
      providerEventType: null,
      providerPayload: null,
      lastCheckedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...row,
      id: `dlv_${index + 1}`,
    })) as DocumentDelivery[];
    return deliveries.map((delivery) => ({ ...delivery }));
  },
  applyStagedDeliveryReports: async () => {
    await stagedOutcome();
  },
  listDocumentDeliveries: async () => deliveries.map((delivery) => ({ ...delivery })),
}));

const { recordOutgoingDocument } = await import("../../data/record-outgoing-document");

const company = {
  id: "cmp_1",
  name: "Example SARL",
  country: "FR",
  accessPointProvider: "at-shared-ap-fr",
  smpProvider: "at-shared-smp-fr",
} as never;

async function record(apTransactionId: string | null) {
  return await recordOutgoingDocument({
    c: null,
    id: "doc_1",
    teamId: "team_1",
    company,
    isPlayground: true,
    useTestNetwork: false,
    inputFormat: "json_api",
    document: {
      senderId: "0225:123456789",
      receiverId: "0208:987654321",
      docTypeId: "doc-type",
      processId: "process",
      countryC1: "FR",
      type: "invoice",
      parsed: null,
      xml: "<Invoice/>",
    },
    delivery: {
      kind: "peppol",
      sentPeppol: true,
      emailRecipients: [],
      as4Response: {
        ok: true,
        peppolMessageId: null,
        peppolConversationId: null,
        receivedPeppolSignalMessage: null,
        sbdhInstanceIdentifier: "env-1",
        apTransactionId,
      },
    },
  });
}

describe("the deliveries a recorded document returns", () => {
  it("reflect a report the webhook applied between the insert and the staging check", async () => {
    // The webhook got to the delivery first: by the time this call looks for a staged
    // report, the delivery is already final and there is nothing staged.
    stagedOutcome = async () => {
      deliveries[0]!.status = "failed";
      deliveries[0]!.failureCategory = "validation";
      deliveries[0]!.failureProviderCode = "TXE-1005";
      return "unchanged";
    };

    const recorded = await record("tx-1");

    expect(recorded.id).toBe("doc_1");
    expect(recorded.deliveries).toHaveLength(1);
    expect(recorded.deliveries[0]).toMatchObject({
      channel: "peppol",
      status: "failed",
      failureCategory: "validation",
      failureProviderCode: "TXE-1005",
    });
    expect(events).toContain("peppol.document.sent.v1");
  });

  it("reflect a staged report this call applied itself", async () => {
    stagedOutcome = async () => {
      deliveries[0]!.status = "delivered";
      return "applied";
    };

    const recorded = await record("tx-2");

    expect(recorded.deliveries[0]).toMatchObject({ status: "delivered" });
  });

  it("are the pending rows as inserted when no report has arrived", async () => {
    stagedOutcome = async () => "unchanged";

    const recorded = await record("tx-3");

    expect(recorded.deliveries[0]).toMatchObject({ status: "pending", providerTransactionId: "tx-3" });
  });
});
