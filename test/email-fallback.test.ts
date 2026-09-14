import { describe, expect, it } from "bun:test";
import {
  emailFallbackRequest,
  runEmailFallback,
  EMAIL_FALLBACK_CLAIM_STALE_MS,
  OUTCOME_NOT_RECORDED_MESSAGE,
  type EmailFallbackDelivery,
  type EmailFallbackDependencies,
  type EmailFallbackDeliveryRow,
  type EmailFallbackDocument,
  type EmailFallbackRequest,
} from "../data/deliveries/email-fallback";

describe("keeping the email fallback with the document", () => {
  const email = { when: "on_peppol_failure" as const, to: ["a@example.com"], subject: "Invoice 1" };

  it("keeps the request when the email is for a failure and the transmission was accepted", () => {
    expect(emailFallbackRequest(email, true)).toEqual({ to: ["a@example.com"], subject: "Invoice 1" });
    expect(emailFallbackRequest({ ...email, htmlBody: "<p>Hi</p>" }, true)).toEqual({
      to: ["a@example.com"],
      subject: "Invoice 1",
      htmlBody: "<p>Hi</p>",
    });
  });

  it("keeps an address named twice only once, so it is only ever mailed once", () => {
    expect(emailFallbackRequest({ ...email, to: ["a@example.com", "a@example.com"] }, true)).toEqual({
      to: ["a@example.com"],
      subject: "Invoice 1",
    });
  });

  it("keeps nothing when the email already went out or was never asked for", () => {
    // Sent with the transmission, whatever becomes of it.
    expect(emailFallbackRequest({ ...email, when: "always" }, true)).toBeNull();
    // Refused in the send: the pipeline mailed it right there.
    expect(emailFallbackRequest(email, false)).toBeNull();
    expect(emailFallbackRequest({ ...email, to: [] }, true)).toBeNull();
    expect(emailFallbackRequest(null, true)).toBeNull();
    expect(emailFallbackRequest(undefined, true)).toBeNull();
  });
});

const document: EmailFallbackDocument = {
  id: "doc_1",
  teamId: "team_1",
  companyId: "cmp_1",
  type: "invoice",
  senderId: "0225:123456789",
  receiverId: "0208:987654321",
  envelopeId: "env-1",
  emailRecipients: [],
  isPlayground: false,
  useTestNetwork: false,
  request: { to: ["a@example.com", "b@example.com"], subject: "Invoice 1" },
};

/**
 * The document row as the database keeps it: the fallback request is a value on the
 * row that a run marks started, notes addresses in, and finally clears. The fake
 * follows the same rules the statements do, so a run that stops halfway leaves the
 * row in the state a later run would really find.
 */
function fakeDependencies(options: {
  document: EmailFallbackDocument | null;
  failing?: string[];
  /** Ids of deliveries a stopped run wrote before this one starts. */
  existingDeliveries?: EmailFallbackDelivery[];
  finishFails?: () => boolean;
}) {
  let request: EmailFallbackRequest | null = options.document?.request ?? null;
  const sent: string[] = [];
  const messages: { to: string; metadata: Record<string, string> }[] = [];
  const deliveries = new Map<string, EmailFallbackDelivery>(
    (options.existingDeliveries ?? []).map((delivery) => [delivery.id, delivery])
  );
  const finished: Parameters<EmailFallbackDependencies["finish"]>[0][] = [];
  const audited: Parameters<EmailFallbackDependencies["audit"]>[0][] = [];
  const deps: EmailFallbackDependencies = {
    async claim(_documentId, { now, staleBefore }) {
      if (!options.document || !request) {
        return null;
      }
      const startedAt = request.startedAt ? new Date(request.startedAt) : null;
      if (startedAt && startedAt >= staleBefore) {
        return null;
      }
      const taken = request;
      request = { ...taken, startedAt: now.toISOString() };
      return { ...options.document, request: taken };
    },
    async noteAttempt(_documentId, address, deliveryId) {
      if (!request) {
        return;
      }
      request = { ...request, attempts: { ...request.attempts, [address]: { deliveryId } } };
    },
    async recordedDelivery(deliveryId) {
      return deliveries.get(deliveryId) ?? null;
    },
    async loadPayload() {
      return { xml: "<Invoice/>", parsed: null };
    },
    async sendEmail(email) {
      if (options.failing?.includes(email.to)) {
        throw new Error(`Mailbox ${email.to} rejected the message`);
      }
      sent.push(email.to);
      messages.push({ to: email.to, metadata: email.metadata });
      return { messageId: `msg-${sent.length}` };
    },
    async recordDelivery(row: EmailFallbackDeliveryRow) {
      const existing = deliveries.get(row.id!);
      if (existing) {
        return existing;
      }
      const written: EmailFallbackDelivery = {
        id: row.id!,
        address: row.address,
        status: row.status,
        failureCategory: row.failureCategory ?? null,
        failureMessage: row.failureMessage ?? null,
        provider: row.provider ?? null,
        providerTransactionId: row.providerTransactionId ?? null,
      };
      deliveries.set(written.id, written);
      return written;
    },
    async finish(outcome) {
      if (options.finishFails?.()) {
        throw new Error("event storage unavailable");
      }
      if (!request) {
        return false;
      }
      request = null;
      finished.push(outcome);
      return true;
    },
    async release() {
      if (request) {
        const { startedAt: _startedAt, ...kept } = request;
        request = kept;
      }
    },
    async audit(event) {
      audited.push(event);
    },
  };
  return { deps, sent, messages, deliveries, finished, audited, request: () => request };
}

describe("sending the email fallback after a later failure", () => {
  it("sends each requested address once, as the sending pipeline would, and bills what went out", async () => {
    const { deps, sent, messages, finished, audited, request } = fakeDependencies({ document });
    const now = new Date("2026-09-09T12:00:00Z");

    const outcome = await runEmailFallback("doc_1", deps, now);

    expect(outcome).toMatchObject({
      kind: "sent",
      sent: ["a@example.com", "b@example.com"],
      failed: [],
    });
    expect(sent).toEqual(["a@example.com", "b@example.com"]);
    expect(finished).toHaveLength(1);
    expect(finished[0]!.deliveries).toEqual([
      expect.objectContaining({ address: "a@example.com", status: "pending" }),
      expect.objectContaining({ address: "b@example.com", status: "pending" }),
    ]);
    // Each message went out under its delivery's id, and keeps the mail service's id.
    for (const [index, row] of finished[0]!.deliveries.entries()) {
      expect(row.id).toMatch(/^dlv_/);
      expect(row.provider).toBe("postmark");
      expect(row.providerTransactionId).toBe(`msg-${index + 1}`);
      expect(messages[index]!.metadata).toEqual({ deliveryId: row.id, documentId: "doc_1" });
    }
    expect(outcome.kind === "sent" && outcome.deliveries.map((row) => row.id)).toEqual(
      finished[0]!.deliveries.map((row) => row.id)
    );
    expect(finished[0]!.transferEvents.map((event) => event.type)).toEqual(["email", "email"]);
    expect(finished[0]!.sent).toEqual(["a@example.com", "b@example.com"]);
    expect(audited).toEqual([
      { documentId: "doc_1", teamId: "team_1", sent: ["a@example.com", "b@example.com"], failed: [] },
    ]);
    // The request is gone: a later report finds nothing left to do.
    expect(request()).toBeNull();
  });

  it("sends once when two failure reports arrive at the same time", async () => {
    const { deps, sent, finished } = fakeDependencies({ document });

    const outcomes = await Promise.all([runEmailFallback("doc_1", deps), runEmailFallback("doc_1", deps)]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["none", "sent"]);
    expect(sent).toEqual(["a@example.com", "b@example.com"]);
    expect(finished).toHaveLength(1);
  });

  it("does nothing for a document without a waiting request", async () => {
    // No request was kept: the email was never asked for, or went out with the send.
    const { deps, sent, finished, audited } = fakeDependencies({ document: null });

    expect(await runEmailFallback("doc_1", deps)).toEqual({ kind: "none" });
    expect(sent).toEqual([]);
    expect(finished).toEqual([]);
    expect(audited).toEqual([]);
  });

  it("leaves a request another run is holding alone until that run is long overdue", async () => {
    const { deps, sent } = fakeDependencies({
      document: {
        ...document,
        request: { ...document.request, startedAt: new Date("2026-09-09T12:00:00Z").toISOString() },
      },
    });

    const held = new Date("2026-09-09T12:05:00Z");
    expect(await runEmailFallback("doc_1", deps, held)).toEqual({ kind: "none" });
    expect(sent).toEqual([]);

    const overdue = new Date(new Date("2026-09-09T12:00:00Z").getTime() + EMAIL_FALLBACK_CLAIM_STALE_MS + 1);
    expect((await runEmailFallback("doc_1", deps, overdue)).kind).toBe("sent");
    expect(sent).toEqual(["a@example.com", "b@example.com"]);
  });

  it("records an address the mail service refused as a failed delivery and carries on with the others", async () => {
    const { deps, sent, finished } = fakeDependencies({ document, failing: ["a@example.com"] });

    const outcome = await runEmailFallback("doc_1", deps);

    expect(outcome).toMatchObject({
      kind: "sent",
      sent: ["b@example.com"],
      failed: [{ address: "a@example.com", message: "Mailbox a@example.com rejected the message" }],
    });
    expect(sent).toEqual(["b@example.com"]);
    expect(finished[0]!.deliveries).toEqual([
      expect.objectContaining({
        address: "a@example.com",
        status: "failed",
        failureCategory: "transport",
        failureMessage: "Mailbox a@example.com rejected the message",
      }),
      expect.objectContaining({ address: "b@example.com", status: "pending" }),
    ]);
    // Only the email that went out is billed.
    expect(finished[0]!.transferEvents).toHaveLength(1);
    expect(finished[0]!.sent).toEqual(["b@example.com"]);
  });

  it("bills nothing in a playground", async () => {
    const { deps, finished } = fakeDependencies({ document: { ...document, isPlayground: true } });

    await runEmailFallback("doc_1", deps);

    expect(finished[0]!.deliveries).toHaveLength(2);
    expect(finished[0]!.transferEvents).toEqual([]);
  });
});

describe("resuming a fallback run that stopped after the mail service accepted a message", () => {
  it("records and bills the accepted messages once, without mailing anything again", async () => {
    let broken = true;
    const { deps, sent, finished, deliveries } = fakeDependencies({
      document,
      finishFails: () => broken,
    });

    // The messages went out; closing the request found the event store down.
    await expect(runEmailFallback("doc_1", deps)).rejects.toThrow("event storage unavailable");
    expect(sent).toEqual(["a@example.com", "b@example.com"]);
    expect(finished).toEqual([]);
    // The delivery rows of the accepted messages were written as they were accepted.
    expect([...deliveries.values()].map((delivery) => delivery.address)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);

    broken = false;
    const outcome = await runEmailFallback("doc_1", deps);

    expect(outcome).toMatchObject({ kind: "sent", sent: ["a@example.com", "b@example.com"], failed: [] });
    // Nothing was mailed a second time, and the accepted messages are billed once.
    expect(sent).toEqual(["a@example.com", "b@example.com"]);
    expect(deliveries.size).toBe(2);
    expect(finished).toHaveLength(1);
    expect(finished[0]!.transferEvents).toHaveLength(2);
    expect(finished[0]!.sent).toEqual(["a@example.com", "b@example.com"]);
    expect(finished[0]!.deliveries.map((delivery) => delivery.id)).toEqual(
      [...deliveries.values()].map((delivery) => delivery.id)
    );
  });

  it("closes an address whose answer was never recorded as failed rather than mailing it again", async () => {
    // The run noted the address, then stopped before the service's answer was written.
    const { deps, sent, finished } = fakeDependencies({
      document: {
        ...document,
        request: {
          ...document.request,
          to: ["a@example.com"],
          attempts: { "a@example.com": { deliveryId: "dlv_lost" } },
        },
      },
    });

    const outcome = await runEmailFallback("doc_1", deps);

    expect(sent).toEqual([]);
    expect(outcome).toMatchObject({
      kind: "sent",
      sent: [],
      failed: [{ address: "a@example.com", message: OUTCOME_NOT_RECORDED_MESSAGE }],
    });
    expect(finished[0]!.deliveries).toEqual([
      expect.objectContaining({
        id: "dlv_lost",
        address: "a@example.com",
        status: "failed",
        failureCategory: "other",
        failureMessage: OUTCOME_NOT_RECORDED_MESSAGE,
      }),
    ]);
    // Nothing went out, so nothing is billed.
    expect(finished[0]!.transferEvents).toEqual([]);
  });

  it("writes nothing when another run closed the request while this one was working", async () => {
    const { deps, finished } = fakeDependencies({ document });
    // The claim happens first; the request is closed by the other run before finish.
    const running = runEmailFallback("doc_1", deps);
    const other = runEmailFallback("doc_1", deps);

    expect((await running).kind).toBe("sent");
    expect((await other).kind).toBe("none");
    expect(finished).toHaveLength(1);
  });
});
