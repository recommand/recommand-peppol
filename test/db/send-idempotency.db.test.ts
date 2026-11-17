import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import type { Pool } from "pg";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl, truncateDocumentData } from "./harness";

// A send that names an Idempotency-Key, as a client sees it: a retry after a lost
// response, or two at once, sends one document and bills it once. The documents go
// out by email, through a mail service that only takes note of what it's handed, or
// over Peppol, through an access point that answers as each test needs.

let pool: Pool;
let app: Hono;
let authorization: string;
let accessPointAnswer: () => Record<string, unknown>;
let handedToAccessPoint: number;
let mailAnswer: () => Promise<{ messageId: string }>;
let simulatorAnswer: () => Promise<void>;
let simulated: number;

const PEPPOL_RECIPIENT = "0208:0428643097";
const BIS3_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const BILLING_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

const invoice = (invoiceNumber = "INV-1") => ({
  document: {
    buyer: { city: "Gent", country: "BE", name: "Buyer BV", postalZone: "9000", street: "Kouter 1", vatNumber: null },
    invoiceNumber,
    issueDate: "2026-11-13",
    lines: [{ name: "Consulting", netPriceAmount: "100.00", quantity: "1", unitCode: "HUR", vat: { category: "S", percentage: "21.00" } }],
    paymentMeans: [{ iban: "BE68539007547034", paymentMethod: "credit_transfer", reference: invoiceNumber }],
  },
  documentType: "invoice",
  email: { to: ["accounts@buyer.example"], when: "always" },
  recipient: null,
});

/** The same invoice for a buyer on Peppol, without an email to fall back on. */
const peppolInvoice = () => ({
  ...invoice(),
  doctypeId: BIS3_INVOICE,
  email: undefined,
  processId: BILLING_PROCESS,
  recipient: PEPPOL_RECIPIENT,
});

const send = async (
  body: unknown,
  idempotencyKey?: string,
  { as = authorization, companyId = COMPANY_ID, path = "send" }: { as?: string; companyId?: string; path?: string } = {}
) => {
  const response = await app.request(`/${companyId}/${path}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: as,
      "Content-Type": "application/json",
      ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
    },
    method: "POST",
  });

  return { body: await response.json(), headers: response.headers, status: response.status };
};

const count = async (table: string) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

/** How many send requests the metrics counted with an outcome, as Prometheus reads them. */
const countedSends = async (outcome: string) => {
  const { registry } = await import("../../utils/metrics");

  return registry
    .render()
    .split("\n")
    .filter((line) => line.startsWith("peppol_send_document_requests_total{") && line.includes(`outcome="${outcome}"`))
    .reduce((total, line) => total + Number(line.split(" ").at(-1)), 0);
};

/** A verified Belgian company of the team sending through the regular access point, and an API key of the team. */
const seedSender = async ({ companyId, teamId }: { companyId: string; teamId: string }) => {
  await pool.query(
    `UPDATE peppol_companies SET country = 'BE', enterprise_number_scheme = '0208', enterprise_number = '0123456749', vat_number = 'BE0123456749',
       is_verified = true, access_point_provider = 'recommand-ap1', smp_provider = 'recommand-smp1' WHERE id = $1`,
    [companyId]
  );
  await pool.query(
    `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ($1, $2, '0208', '0123456749')`,
    [`ci_${companyId}`, companyId]
  );
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'unused')`, [`usr_${teamId}`, `${teamId}@example.com`]);
  await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, [teamId, `usr_${teamId}`]);
  await pool.query(
    `INSERT INTO api_keys (id, name, team_id, user_id, secret_hash) VALUES ($1, 'Sender', $2, $3, $4)`,
    [`key_${teamId}`, teamId, `usr_${teamId}`, await Bun.password.hash("secret", { algorithm: "bcrypt", cost: 4 })]
  );

  return `Basic ${Buffer.from(`key_${teamId}:secret`).toString("base64")}`;
};

describe.skipIf(!testDatabaseUrl)("sending with an Idempotency-Key against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    // The validation and mail services are services of their own; what they do isn't what's tested here
    mock.module("../../utils/pipelines/sending/validate-document", () => ({
      validateDocument: async () => ({ errors: [], result: "valid" }),
    }));
    const email = await import("../../data/email/send-email");
    mock.module("@peppol/data/email/send-email", () => ({
      ...email,
      sendDocumentEmail: () => mailAnswer(),
    }));
    // The Peppol network: the recipient is registered, and the access point answers as a test sets it up to
    const recipient = await import("../../data/recipient");
    mock.module("@peppol/data/recipient", () => ({ ...recipient, isParticipantUnregistered: async () => false }));
    // The playground's simulated network, which answers as a test sets it up to
    const simulator = await import("../../data/playground/simulate-ap");
    mock.module("@peppol/data/playground/simulate-ap", () => ({
      ...simulator,
      simulateSendAs4: async () => {
        simulated += 1;

        return simulatorAnswer();
      },
    }));
    const accessPoints = await import("../../data/access-point-providers");
    mock.module("@peppol/data/access-point-providers", () => ({
      ...accessPoints,
      getAccessPointProvider: () => ({
        sendAs4: async () => {
          handedToAccessPoint += 1;

          return accessPointAnswer();
        },
      }),
    }));
    process.env.JWT_SECRET ??= "send-idempotency-test-secret";

    await seedTeamAndCompany(pool);
    authorization = await seedSender({ companyId: COMPANY_ID, teamId: TEAM_ID });

    (await import("../../lib/event-types")).registerPeppolEventTypes();
    const { default: sendDocument } = await import("../../api/send-document");
    const { createErrorHandler } = await import("@recommand/lib/error-handler");
    app = new Hono();
    app.route("/", sendDocument as never);
    // As the server answers what a route throws
    app.onError(createErrorHandler({ isDev: false }));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    accessPointAnswer = () => ({ ok: true, peppolConversationId: null, peppolMessageId: "msg-1", receivedPeppolSignalMessage: null, sbdhInstanceIdentifier: "env-1" });
    handedToAccessPoint = 0;
    mailAnswer = async () => ({ messageId: `msg_${crypto.randomUUID()}` });
    simulated = 0;
    simulatorAnswer = async () => {};
    await truncateDocumentData(pool);
    await pool.query("TRUNCATE idempotency_keys");
  });

  it("sends a retried request once and bills it once, and hands the retry the first response", async () => {
    const first = await send(invoice(), "retry-after-timeout");
    expect(first.status).toBe(200);
    expect(first.headers.get("Idempotency-Replayed")).toBeNull();
    expect(first.headers.get("Idempotency-Key-Expires-At")).not.toBeNull();

    const retry = await send(invoice(), "retry-after-timeout");
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(retry.headers.get("Content-Type")).toBe(first.headers.get("Content-Type"));
    expect(retry.body).toEqual(first.body);

    expect(await count("peppol_transmitted_documents")).toBe(1);
    expect(await count("peppol_transfer_events")).toBe(1);
  });

  it("runs a request under an expired key as a new one", async () => {
    await send(invoice(), "expired");
    await pool.query("UPDATE idempotency_keys SET expires_at = now() - interval '1 second'");

    const later = await send(invoice(), "expired");
    expect(later.status).toBe(200);
    expect(later.headers.get("Idempotency-Replayed")).toBeNull();
    expect(await count("peppol_transmitted_documents")).toBe(2);
  });

  it("purges expired keys only", async () => {
    await send(invoice(), "kept");
    await send(invoice("INV-2"), "purged");
    await pool.query("UPDATE idempotency_keys SET expires_at = now() - interval '1 second' WHERE key = 'purged'");

    const { purgeExpiredIdempotencyKeys } = await import("@core/data/idempotency-keys");
    await purgeExpiredIdempotencyKeys();
    expect((await pool.query("SELECT key FROM idempotency_keys")).rows).toEqual([{ key: "kept" }]);
  });

  it("takes a key sent bare and the same key quoted as the same key", async () => {
    await send(invoice(), "quoted-or-not");
    const retry = await send(invoice(), '"quoted-or-not"');
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await count("peppol_transmitted_documents")).toBe(1);
  });

  it("sends once when two requests with the same key arrive together", async () => {
    const responses = await Promise.all([send(invoice(), "at-once"), send(invoice(), "at-once")]);

    expect(await count("peppol_transmitted_documents")).toBe(1);
    expect(await count("peppol_transfer_events")).toBe(1);
    // The other one is either told to wait, or gets the first one's response if that was in by then
    const others = responses.filter(({ headers, status }) => status !== 200 || headers.get("Idempotency-Replayed"));
    expect(others).toHaveLength(1);
    if (others[0]!.status === 409) {
      expect(others[0]!.body.code).toBe("idempotency_in_progress");
      expect(others[0]!.headers.get("Retry-After")).not.toBeNull();
    }
  });

  it("refuses a different request under a key that was already used, without sending it", async () => {
    await send(invoice("INV-1"), "one-key");
    const other = await send(invoice("INV-2"), "one-key");

    expect(other.status).toBe(422);
    expect(other.body.code).toBe("idempotency_conflict");
    expect(other.headers.get("Link")).toBe('<https://docs.recommand.eu/docs/sending-invoices#retry-safely>; rel="describedby"');
    expect(await count("peppol_transmitted_documents")).toBe(1);
  });

  it("counts a request its key refuses apart from sends that failed", async () => {
    await send(invoice("INV-1"), "counted");
    const [refused, failed] = [await countedSends("idempotency_refused"), await countedSends("delivery_failed")];

    await send(invoice("INV-2"), "counted");
    expect(await countedSends("idempotency_refused")).toBe(refused + 1);
    expect(await countedSends("delivery_failed")).toBe(failed);
  });

  it("leaves a key free when the request under it was refused", async () => {
    const refused = await send({ ...invoice(), email: undefined }, "fix-and-retry");
    expect(refused.status).toBe(400);

    const fixed = await send(invoice(), "fix-and-retry");
    expect(fixed.status).toBe(200);
    expect(fixed.headers.get("Idempotency-Replayed")).toBeNull();
    expect(await count("peppol_transmitted_documents")).toBe(1);
  });

  it("repeats the failure of a request that may have taken effect after an unexpected error, without running it again", async () => {
    // The email goes out, and then storing the document fails
    await pool.query(`CREATE FUNCTION refuse_documents() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'storage unavailable'; END $$`);
    await pool.query(`CREATE TRIGGER refuse_documents BEFORE INSERT ON peppol_transmitted_documents
      FOR EACH ROW EXECUTE FUNCTION refuse_documents()`);
    const failed = await send(invoice(), "unknown-outcome").finally(() =>
      pool.query("DROP TRIGGER refuse_documents ON peppol_transmitted_documents; DROP FUNCTION refuse_documents()")
    );
    // The route says the document may have been delivered
    expect(failed.status).toBe(422);
    expect(failed.body.outcomeUnknown).toBe(true);

    const retry = await send(invoice(), "unknown-outcome");
    expect(retry.status).toBe(422);
    expect(retry.body).toEqual(failed.body);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await count("peppol_transmitted_documents")).toBe(0);
  });

  it("says a send that failed after its document was stored may have gone out, and repeats that failure", async () => {
    // The email goes out and the document is stored, and then recording its usage fails
    await pool.query(`CREATE FUNCTION refuse_usage() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'usage storage unavailable'; END $$`);
    await pool.query(`CREATE TRIGGER refuse_usage BEFORE INSERT ON peppol_transfer_events
      FOR EACH ROW EXECUTE FUNCTION refuse_usage()`);
    const failed = await send(invoice(), "failed-after-storing").finally(() =>
      pool.query("DROP TRIGGER refuse_usage ON peppol_transfer_events; DROP FUNCTION refuse_usage()")
    );
    expect(failed.status).toBe(422);
    expect(failed.body.outcomeUnknown).toBe(true);
    expect(await count("peppol_transmitted_documents")).toBe(1);

    const retry = await send(invoice(), "failed-after-storing");
    expect(retry.status).toBe(422);
    expect(retry.body).toEqual(failed.body);
    expect(await count("peppol_transmitted_documents")).toBe(1);
  });

  it("frees a key after a refusal before any channel, with the error's instruction", async () => {
    await pool.query("DELETE FROM peppol_company_identifiers WHERE company_id = $1", [COMPANY_ID]);
    try {
      // The company can fix this itself, so the answer says how
      const refused = await send(peppolInvoice(), "before-any-channel");
      expect(refused.status).toBe(400);
      expect(refused.body.errors.root[0]).toContain("No sending company identifier found");
    } finally {
      await pool.query(
        `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ($1, $2, '0208', '0123456749')`,
        [`ci_${COMPANY_ID}`, COMPANY_ID]
      );
    }

    expect((await send(peppolInvoice(), "before-any-channel")).status).toBe(200);
    expect(handedToAccessPoint).toBe(1);
  });

  it("answers a failure on Recommand's side before any channel with a 500 and frees the key, since nothing went out", async () => {
    await pool.query("ALTER TABLE peppol_company_identifiers RENAME TO peppol_company_identifiers_away");
    try {
      const failed = await send(peppolInvoice(), "server-side-failure");
      expect(failed.status).toBe(500);
      expect(JSON.stringify(failed.body)).not.toContain("peppol_company_identifiers");
    } finally {
      await pool.query("ALTER TABLE peppol_company_identifiers_away RENAME TO peppol_company_identifiers");
    }

    expect((await send(peppolInvoice(), "server-side-failure")).status).toBe(200);
    expect(handedToAccessPoint).toBe(1);
  });

  it("repeats the failure when no email was confirmed by the mail service, since it may have sent one", async () => {
    mailAnswer = async () => {
      throw new Error("mail service unavailable");
    };
    const failed = await send(invoice(), "unconfirmed-email");
    expect(failed.status).toBe(422);

    mailAnswer = async () => ({ messageId: `msg_${crypto.randomUUID()}` });
    const retry = await send(invoice(), "unconfirmed-email");
    expect(retry.status).toBe(422);
    expect(retry.body).toEqual(failed.body);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await count("peppol_transmitted_documents")).toBe(0);
  });

  it("repeats the failure when the connection to the access point was lost, since it may have sent the document", async () => {
    accessPointAnswer = () => ({ ok: false, outcomeUnknown: true, peppolConversationId: null, peppolMessageId: null, receivedPeppolSignalMessage: null, sbdhInstanceIdentifier: null });
    const failed = await send(peppolInvoice(), "lost-connection");
    expect(failed.status).toBe(422);

    const retry = await send(peppolInvoice(), "lost-connection");
    expect(retry.status).toBe(422);
    expect(retry.body).toEqual(failed.body);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(handedToAccessPoint).toBe(1);
  });

  it("frees a key when the access point refused the document before sending it, so it can be retried", async () => {
    accessPointAnswer = () => ({
      ok: false,
      peppolConversationId: null,
      peppolMessageId: null,
      receivedPeppolSignalMessage: null,
      sbdhInstanceIdentifier: null,
      sendingException: { category: "document_not_supported", message: "Not accepted" },
    });
    expect((await send(peppolInvoice(), "refused-by-access-point")).status).toBe(422);
    expect((await send(peppolInvoice(), "refused-by-access-point")).status).toBe(422);
    expect(handedToAccessPoint).toBe(2);
  });

  it("answers a send as it went when noting its outcome with the key fails, and holds the key back without a response to repeat", async () => {
    await pool.query(`CREATE FUNCTION refuse_completion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'key storage unavailable'; END $$`);
    await pool.query(`CREATE TRIGGER refuse_completion BEFORE UPDATE ON idempotency_keys
      FOR EACH ROW EXECUTE FUNCTION refuse_completion()`);
    try {
      const first = await send(invoice(), "unrecorded-outcome");
      expect(first.status).toBe(200);
      expect(first.body.id).toStartWith("doc_");
    } finally {
      await pool.query("DROP TRIGGER refuse_completion ON idempotency_keys; DROP FUNCTION refuse_completion()");
    }

    expect((await send(invoice(), "unrecorded-outcome")).body.code).toBe("idempotency_in_progress");
    // Once the first request can't still be running, by the database's clock, there's no response to repeat
    await pool.query("UPDATE idempotency_keys SET created_at = now() - interval '11 minutes'");
    expect((await send(invoice(), "unrecorded-outcome")).body.code).toBe("idempotency_outcome_unknown");
    expect(await count("peppol_transmitted_documents")).toBe(1);
  });

  describe("in the playground", () => {
    beforeEach(async () => {
      await pool.query("UPDATE peppol_team_extensions SET is_playground = true WHERE id = $1", [TEAM_ID]);
    });

    afterAll(async () => {
      await pool.query("UPDATE peppol_team_extensions SET is_playground = false WHERE id = $1", [TEAM_ID]);
    });

    it("frees a key when the simulated network doesn't know the recipient", async () => {
      const { PlaygroundRecipientNotFoundError } = await import("../../data/playground/simulate-ap");
      simulatorAnswer = async () => {
        throw new PlaygroundRecipientNotFoundError(PEPPOL_RECIPIENT);
      };
      expect((await send(peppolInvoice(), "unknown-playground-recipient")).status).toBe(422);
      expect((await send(peppolInvoice(), "unknown-playground-recipient")).status).toBe(422);
      expect(simulated).toBe(2);
    });

    it("repeats the failure when the simulation failed otherwise, since it may have delivered the document", async () => {
      simulatorAnswer = async () => {
        throw new Error("receiving team unavailable");
      };
      const failed = await send(peppolInvoice(), "failed-simulation");
      expect(failed.status).toBe(422);

      const retry = await send(peppolInvoice(), "failed-simulation");
      expect(retry.status).toBe(422);
      expect(retry.body).toEqual(failed.body);
      expect(simulated).toBe(1);
    });
  });

  it("runs a key another team used as a new request", async () => {
    await pool.query(`INSERT INTO teams (id, name) VALUES ('team_other', 'Other team')`);
    await pool.query(`INSERT INTO peppol_team_extensions (id, is_playground, use_test_network) VALUES ('team_other', false, false)`);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, access_point_provider, smp_provider)
       VALUES ('cmp_other', 'team_other', 'Other BV', 'Kouter 2', '9000', 'Gent', 'BE', 'recommand-ap1', 'recommand-smp1')`
    );
    const otherTeam = await seedSender({ companyId: "cmp_other", teamId: "team_other" });
    try {
      await send(invoice(), "shared-key");
      const other = await send(invoice(), "shared-key", { as: otherTeam, companyId: "cmp_other" });
      expect(other.status).toBe(200);
      expect(other.headers.get("Idempotency-Replayed")).toBeNull();
      expect(await count("peppol_transmitted_documents")).toBe(2);
    } finally {
      await pool.query("DELETE FROM teams WHERE id = 'team_other'");
      await pool.query("DELETE FROM users WHERE id = 'usr_team_other'");
    }
  });

  it("refuses a key used on one send route on the other one too", async () => {
    await send(invoice(), "one-route");
    const other = await send(invoice(), "one-route", { path: "sendDocument" });

    expect(other.status).toBe(422);
    expect(other.body.code).toBe("idempotency_conflict");
    expect(await count("peppol_transmitted_documents")).toBe(1);
  });

  it("refuses a key sent twice, which arrives as two keys joined by a comma", async () => {
    const response = await send(invoice(), "first, second");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_idempotency_key");
  });

  it("treats an empty key as no key, as before", async () => {
    await send(invoice(), "");
    await send(invoice(), "");
    expect(await count("peppol_transmitted_documents")).toBe(2);
  });

  it("refuses a key that isn't one, linking the documentation on retrying safely", async () => {
    const response = await send(invoice(), "x".repeat(256));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_idempotency_key");
    expect(response.headers.get("Link")).toBe('<https://docs.recommand.eu/docs/sending-invoices#retry-safely>; rel="describedby"');
    expect(await count("peppol_transmitted_documents")).toBe(0);
  });

  it("sends every request without a key, as before", async () => {
    await send(invoice());
    await send(invoice());
    expect(await count("peppol_transmitted_documents")).toBe(2);
  });
});
