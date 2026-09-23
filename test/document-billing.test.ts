import { describe, expect, it } from "bun:test";
import { buildOutgoingTransferEvents } from "../data/outgoing-document-row";
import { isBillableDocument } from "../utils/type-repository/document-types/billing";
import { franceCdarSchema, getFranceCdarPhaseForStatus } from "../utils/parsing/france-cdar/schemas";

const cdar = (statusCode: string) => {
  const phase = getFranceCdarPhaseForStatus(statusCode as never);
  // A transmission status is set by a platform (no issuer id); a processing
  // status by the buyer, or by the seller for a collection.
  const issuer =
    phase === "305"
      ? { issuerRole: "WK" }
      : {
          issuerRole: statusCode === "212" ? "SE" : "BY",
          issuerLegalId: "123456789",
          issuerLegalIdScheme: "0002",
        };
  return franceCdarSchema.parse({
    id: `cdar-${statusCode}`,
    issueDate: "2026-08-17T14:05:09",
    businessProcess: "REGULATED",
    phase,
    senderRole: "WK",
    ...issuer,
    recipientRole: "SE",
    recipientElectronicAddress: "987654321",
    recipientElectronicAddressScheme: "0225",
    statusCode,
    statusDate: "2026-08-17T14:05:09",
    invoiceId: "INV-2026-001",
    invoiceTypeCode: "380",
    invoiceIssueDate: "2026-08-17",
    sellerLegalId: "987654321",
    sellerLegalIdScheme: "0002",
    ...(statusCode === "212"
      ? { collectedAmounts: [{ amount: "100.00", currency: "EUR", vatPercent: "20.00" }] }
      : {}),
    // Rejections and refusals carry the reason the sender has to act on.
    ...(statusCode === "213" ? { reasonCode: "REJ_SEMAN" } : {}),
    ...(["206", "207", "208", "210"].includes(statusCode) ? { reasonCode: "TX_TVA_ERR" } : {}),
  });
};

describe("Document billing", () => {
  it("charges business documents and reports", () => {
    for (const type of ["invoice", "creditNote", "selfBillingInvoice", "frenchB2CSalesReport", "frenchB2BiInvoiceReport"] as const) {
      expect(isBillableDocument(type, null)).toBe(true);
    }
  });

  it("never charges a message level response", () => {
    expect(isBillableDocument("messageLevelResponse", null)).toBe(false);
  });

  it("charges French lifecycle statuses of the processing phase only", () => {
    // Transmission phase: a platform recorded a technical step. Free, like an MLS.
    for (const statusCode of ["200", "201", "202", "203", "213"]) {
      const parsed = cdar(statusCode);
      expect(parsed.phase).toBe("305");
      expect(isBillableDocument("frenchInvoicingCdar", parsed)).toBe(false);
    }
    // Processing phase: a party decided something about the invoice. Charged, like
    // an invoice response.
    for (const statusCode of ["204", "205", "206", "207", "208", "209", "210", "211", "212", "214"]) {
      const parsed = cdar(statusCode);
      expect(parsed.phase).toBe("23");
      expect(isBillableDocument("frenchInvoicingCdar", parsed)).toBe(true);
    }
  });

  it("derives the phase from the status when a stored status lacks it, and charges nothing it cannot classify", () => {
    expect(isBillableDocument("frenchInvoicingCdar", { statusCode: "205" } as never)).toBe(true);
    expect(isBillableDocument("frenchInvoicingCdar", { statusCode: "202" } as never)).toBe(false);
    expect(isBillableDocument("frenchInvoicingCdar", null)).toBe(false);
  });

  it("writes no transfer event for a status a platform generated, however it was sent", () => {
    const base = {
      teamId: "team_1",
      companyId: "cmp_1",
      transmittedDocumentId: "doc_1",
      delivery: {
        kind: "peppol" as const,
        sentPeppol: true,
        emailRecipients: ["a@example.com"],
        as4Response: null,
      },
    };
    expect(
      buildOutgoingTransferEvents({
        ...base,
        document: { type: "frenchInvoicingCdar", parsed: cdar("202") },
      }),
    ).toEqual([]);
    expect(
      buildOutgoingTransferEvents({
        ...base,
        document: { type: "frenchInvoicingCdar", parsed: cdar("210") },
      }).map((event) => event.type),
    ).toEqual(["peppol", "email"]);
  });
});
