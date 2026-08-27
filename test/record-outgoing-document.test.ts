import { describe, expect, it } from "bun:test";
import {
  buildOutgoingDocumentRow,
  buildOutgoingTransferEvents,
  type OutgoingDocumentDelivery,
  type OutgoingDocumentPayload,
} from "../data/outgoing-document-row";
import type { Company } from "../data/companies";
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

  it("bills a report exactly once, like a transmission", () => {
    const base = {
      teamId: "team_1",
      companyId: company.id,
      transmittedDocumentId: "doc_1",
    };

    expect(
      buildOutgoingTransferEvents({ ...base, delivery: reportingDelivery })
    ).toEqual([
      { ...base, direction: "outgoing", type: "reporting" },
    ]);
    expect(
      buildOutgoingTransferEvents({ ...base, delivery: peppolDelivery })
    ).toEqual([{ ...base, direction: "outgoing", type: "peppol" }]);
  });

  it("bills one event per email recipient alongside the Peppol transmission", () => {
    const events = buildOutgoingTransferEvents({
      teamId: "team_1",
      companyId: company.id,
      transmittedDocumentId: "doc_1",
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
