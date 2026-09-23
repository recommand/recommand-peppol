import { describe, expect, it } from "bun:test";
import {
  buildOutgoingDocumentDeliveries,
  buildOutgoingDocumentRow,
  buildOutgoingTransferEvents,
  type OutgoingDocumentDelivery,
  type OutgoingDocumentPayload,
} from "../data/outgoing-document-row";
import type { Company } from "@peppol/data/companies";
import {
  frenchB2CReportSchema,
  getFrenchB2CReportDocumentProfile,
} from "../utils/parsing/b2c-reporting/france";
import { peppolUblBis3InvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-invoice";

const company = {
  id: "cmp_1",
  name: "ACME SARL",
  country: "FR",
  accessPointProvider: "recommand-ap1",
  smpProvider: "recommand-smp1",
} as unknown as Company;

const storage = {
  createdAt: new Date("2026-07-27T10:00:00Z"),
  s3KeyPrefix: null,
  originalPayloadLocation: "none",
  originalPayloadContainerFormat: "none",
} as const;

const report = frenchB2CReportSchema.parse({
  reference: "SALES-2026-07-01-GOODS",
  type: "sales",
  date: "2026-07-01",
  category: "goods",
  taxExclusiveAmount: "10000.00",
  taxAmount: "2000.00",
  transactionCount: 42,
  vatBreakdown: [
    { percentage: "20.00", taxableAmount: "10000.00", taxAmount: "2000.00" },
  ],
});
const reportProfile = getFrenchB2CReportDocumentProfile("sales");

const reportingDocument: OutgoingDocumentPayload = {
  senderId: "0009:123456789",
  receiverId: null,
  docTypeId: reportProfile.docTypeId,
  processId: reportProfile.processId,
  countryC1: "FR",
  type: "frenchB2CSalesReport",
  parsed: report,
  xml: null,
};

const peppolDocument: OutgoingDocumentPayload = {
  senderId: "0009:123456789",
  receiverId: "0208:987654321",
  docTypeId: peppolUblBis3InvoiceFormat.docTypeId,
  processId: peppolUblBis3InvoiceFormat.supportedProcessIds[0],
  countryC1: "FR",
  type: "invoice",
  parsed: null,
  xml: "<Invoice/>",
};

const peppolDelivery: OutgoingDocumentDelivery = {
  kind: "peppol",
  sentPeppol: true,
  emailRecipients: [],
  as4Response: {
    ok: true,
    peppolMessageId: "msg-1",
    peppolConversationId: "conv-1",
    sbdhInstanceIdentifier: "env-1",
    apTransactionId: "tx-1",
    receivedPeppolSignalMessage: "<signal/>",
  } as never,
};

const reportingDelivery: OutgoingDocumentDelivery = {
  kind: "reporting",
  externalReferenceId: "flow-123",
};

describe("outgoing document recording", () => {
  it("records a filed report as an outgoing document with no transmission", () => {
    const row = buildOutgoingDocumentRow({
      id: "doc_report",
      teamId: "team_1",
      company,
      document: reportingDocument,
      delivery: reportingDelivery,
      storage,
    });

    expect(row).toMatchObject({
      direction: "outgoing",
      type: "frenchB2CSalesReport",
      receiverId: null,
      xml: null,
      xmlLocation: "none",
      attachmentsLocation: "none",
      sentOverPeppol: false,
      sentOverEmail: false,
      emailRecipients: [],
      externalReferenceId: "flow-123",
      // Nothing was transmitted, so every Peppol correlation field stays empty.
      peppolMessageId: null,
      peppolConversationId: null,
      receivedPeppolSignalMessage: null,
      envelopeId: null,
      apTransactionId: null,
    });
    // The report reference is what makes it findable, like a document number.
    expect(row.documentNumber).toBe("SALES-2026-07-01-GOODS");
    expect(row.searchText).toContain("SALES-2026-07-01-GOODS");
  });

  it("keeps the transmission fields for a document sent over Peppol", () => {
    const row = buildOutgoingDocumentRow({
      id: "doc_invoice",
      teamId: "team_1",
      company,
      document: peppolDocument,
      delivery: peppolDelivery,
      storage,
    });

    expect(row).toMatchObject({
      direction: "outgoing",
      type: "invoice",
      xmlLocation: "db",
      sentOverPeppol: true,
      sentOverEmail: false,
      peppolMessageId: "msg-1",
      envelopeId: "env-1",
      apTransactionId: "tx-1",
      externalReferenceId: null,
    });
  });

  it("keeps the email asked for on failure with the document until the outcome is known", () => {
    const row = buildOutgoingDocumentRow({
      id: "doc_invoice",
      teamId: "team_1",
      company,
      document: peppolDocument,
      delivery: { ...peppolDelivery, emailFallback: { to: ["a@example.com"], subject: "Invoice 1" } },
      storage,
    });
    expect(row.emailFallback).toEqual({ to: ["a@example.com"], subject: "Invoice 1" });
    expect(row.sentOverEmail).toBe(false);
    expect(row.emailRecipients).toEqual([]);
  });

  it("bills a report exactly once, like a transmission", () => {
    const base = {
      teamId: "team_1",
      companyId: company.id,
      transmittedDocumentId: "doc_1",
      document: { type: "invoice" as const, parsed: null },
    };

    expect(
      buildOutgoingTransferEvents({ ...base, delivery: reportingDelivery })
    ).toEqual([
      { teamId: base.teamId, companyId: base.companyId, transmittedDocumentId: base.transmittedDocumentId, direction: "outgoing", type: "reporting" },
    ]);
    expect(
      buildOutgoingTransferEvents({ ...base, delivery: peppolDelivery })
    ).toEqual([{ teamId: base.teamId, companyId: base.companyId, transmittedDocumentId: base.transmittedDocumentId, direction: "outgoing", type: "peppol" }]);
  });

  it("bills one event per email recipient alongside the Peppol transmission", () => {
    const events = buildOutgoingTransferEvents({
      teamId: "team_1",
      companyId: company.id,
      transmittedDocumentId: "doc_1",
      document: { type: "invoice", parsed: null },
      delivery: {
        kind: "peppol",
        sentPeppol: true,
        emailRecipients: ["a@example.com", "b@example.com"],
        as4Response: null,
      },
    });

    expect(events.map((event) => event.type)).toEqual([
      "peppol",
      "email",
      "email",
    ]);
  });

  it("writes no transfer event when a document reached nobody", () => {
    expect(
      buildOutgoingTransferEvents({
        teamId: "team_1",
        companyId: company.id,
        transmittedDocumentId: "doc_1",
        document: { type: "invoice", parsed: null },
        delivery: {
          kind: "peppol",
          sentPeppol: false,
          emailRecipients: [],
          as4Response: null,
        },
      })
    ).toEqual([]);
  });
});

describe("outgoing document deliveries", () => {
  const now = new Date("2026-09-09T10:00:00Z");
  const build = (
    delivery: OutgoingDocumentDelivery,
    overrides: { accessPointProvider?: Company["accessPointProvider"]; receiverId?: string | null } = {}
  ) =>
    buildOutgoingDocumentDeliveries({
      transmittedDocumentId: "doc_1",
      teamId: "team_1",
      company: { id: company.id, accessPointProvider: overrides.accessPointProvider ?? "recommand-ap1" },
      document: { receiverId: overrides.receiverId === undefined ? "0208:987654321" : overrides.receiverId },
      delivery,
      useTestNetwork: false,
      now,
    });

  it("records a transmission through our own access point as delivered: the receipt came with the send", () => {
    const rows = build(peppolDelivery);
    expect(rows).toEqual([
      {
        transmittedDocumentId: "doc_1",
        teamId: "team_1",
        companyId: company.id,
        statusChangedAt: now,
        useTestNetwork: false,
        channel: "peppol",
        address: "0208:987654321",
        status: "delivered",
        failureCategory: null,
        failureMessage: null,
        failureProviderCode: null,
        provider: "recommand-ap1",
        providerTransactionId: "tx-1",
      },
    ]);
  });

  it("leaves a transmission through a shared access point pending until it reports the outcome", () => {
    const [row] = build(peppolDelivery, { accessPointProvider: "at-shared-ap-fr" });
    expect(row).toMatchObject({ status: "pending", provider: "at-shared-ap-fr", providerTransactionId: "tx-1" });
  });

  it("records a simulated transmission as delivered without a provider, whatever the company's access point", () => {
    const simulated: OutgoingDocumentDelivery = { kind: "peppol", sentPeppol: true, emailRecipients: [], as4Response: null };
    const [row] = build(simulated, { accessPointProvider: "at-shared-ap-fr" });
    expect(row).toMatchObject({ status: "delivered", provider: null, providerTransactionId: null });
  });

  it("records a refused transmission that fell back to email as failed, with the refusal's reason", () => {
    const rows = build({
      kind: "peppol",
      sentPeppol: false,
      emailRecipients: ["a@example.com", "b@example.com"],
      as4Response: null,
      peppolFailure: { category: "document_not_supported", message: "Not registered for invoices", providerCode: null },
    });
    expect(rows.map((row) => [row.channel, row.address, row.status])).toEqual([
      ["peppol", "0208:987654321", "failed"],
      ["email", "a@example.com", "pending"],
      ["email", "b@example.com", "pending"],
    ]);
    expect(rows[0]).toMatchObject({
      failureCategory: "document_not_supported",
      failureMessage: "Not registered for invoices",
      provider: null,
    });
  });

  it("creates no Peppol delivery for an email-only document", () => {
    const rows = build(
      { kind: "peppol", sentPeppol: false, emailRecipients: ["a@example.com"], as4Response: null },
      { receiverId: null }
    );
    expect(rows.map((row) => row.channel)).toEqual(["email"]);
  });

  it("creates no deliveries for a filed report", () => {
    expect(build(reportingDelivery, { receiverId: null })).toEqual([]);
  });
});

describe("email deliveries of a recorded document", () => {
  const now = new Date("2026-09-09T10:00:00Z");
  const build = (delivery: OutgoingDocumentDelivery) =>
    buildOutgoingDocumentDeliveries({
      transmittedDocumentId: "doc_1",
      teamId: "team_1",
      company: { id: company.id, accessPointProvider: "recommand-ap1" },
      document: { receiverId: null },
      delivery,
      useTestNetwork: false,
      now,
    });

  it("keep the id each message was sent under and the mail service's id for it", () => {
    const rows = build({
      kind: "peppol",
      sentPeppol: false,
      emailRecipients: ["a@example.com", "b@example.com"],
      emailMessages: [
        { deliveryId: "dlv_a", address: "a@example.com", providerMessageId: "msg-a" },
        { deliveryId: "dlv_b", address: "b@example.com", providerMessageId: "msg-b" },
      ],
      as4Response: null,
    });

    expect(rows).toEqual([
      expect.objectContaining({ id: "dlv_a", channel: "email", address: "a@example.com", status: "pending", provider: "postmark", providerTransactionId: "msg-a" }),
      expect.objectContaining({ id: "dlv_b", channel: "email", address: "b@example.com", status: "pending", provider: "postmark", providerTransactionId: "msg-b" }),
    ]);
  });

  it("match an address mailed twice to its two messages in order", () => {
    const rows = build({
      kind: "peppol",
      sentPeppol: false,
      emailRecipients: ["a@example.com", "a@example.com"],
      emailMessages: [
        { deliveryId: "dlv_1", address: "a@example.com", providerMessageId: "msg-1" },
        { deliveryId: "dlv_2", address: "a@example.com", providerMessageId: "msg-2" },
      ],
      as4Response: null,
    });

    expect(rows.map((row) => [row.id, row.providerTransactionId])).toEqual([
      ["dlv_1", "msg-1"],
      ["dlv_2", "msg-2"],
    ]);
  });

  it("carry no reference for a document recorded without message ids", () => {
    const [row] = build({ kind: "peppol", sentPeppol: false, emailRecipients: ["a@example.com"], as4Response: null });

    expect(row).toMatchObject({ channel: "email", status: "pending", provider: null, providerTransactionId: null });
    expect(row).not.toHaveProperty("id");
  });

  it("record an address the mail service refused in the send as a failed delivery with its reason", () => {
    const rows = build({
      kind: "peppol",
      sentPeppol: false,
      emailRecipients: ["b@example.com"],
      emailMessages: [{ deliveryId: "dlv_b", address: "b@example.com", providerMessageId: "msg-b" }],
      emailFailures: [{ deliveryId: "dlv_a", address: "a@example.com", message: "Invalid 'To' address" }],
      as4Response: null,
    });

    expect(rows).toEqual([
      expect.objectContaining({ id: "dlv_b", address: "b@example.com", status: "pending", providerTransactionId: "msg-b" }),
      {
        transmittedDocumentId: "doc_1",
        teamId: "team_1",
        companyId: company.id,
        statusChangedAt: now,
        useTestNetwork: false,
        id: "dlv_a",
        channel: "email",
        address: "a@example.com",
        status: "failed",
        failureCategory: "transport",
        failureMessage: "Invalid 'To' address",
        failureProviderCode: null,
        provider: "postmark",
        providerTransactionId: null,
      },
    ]);
    // Billing and the document's recipients only count what went out.
    expect(
      buildOutgoingTransferEvents({
        teamId: "team_1",
        companyId: company.id,
        transmittedDocumentId: "doc_1",
        document: { type: "invoice", parsed: null },
        delivery: { kind: "peppol", sentPeppol: false, emailRecipients: ["b@example.com"], emailFailures: [{ deliveryId: "dlv_a", address: "a@example.com", message: "refused" }], as4Response: null },
      }).map((event) => event.type)
    ).toEqual(["email"]);
  });
});
