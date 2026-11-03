import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { APICallError } from "ai";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import type { Pool } from "pg";
import {
  buildPdf,
  fakeDecisionModel,
  fakeLanguageModel,
  forbiddenDecisionModel,
  forbiddenLanguageModel,
  invoiceViewText,
  sampleDocument,
} from "../intake/fixtures";
import { MAX_PDF_PAGES, RETRY_BACKOFF_MS } from "../../utils/pipelines/intake/config";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// Document intake against PostgreSQL: the API, the email webhook and the worker, with
// storage in memory and fake models. What only a database shows: claims and leases,
// retries from checkpoints, idempotency, the order of the events and deletion.

const USER_ID = "usr_intake";
const PERMISSIONS = [
  "peppol.imports.read",
  "peppol.imports.write",
  "peppol.inbound_addresses.read",
  "peppol.inbound_addresses.manage",
];
const API_KEY_ID = "key_intake";
// Who the fake session authenticates: the team member, or an API key of that member.
let principal: "user" | "api_key" = "user";
const storage = new Map<string, Buffer>();
const notifications: { transmittedDocumentId: string }[] = [];
const alerts: string[] = [];

let pool: Pool;
let app: Hono;
let worker: typeof import("../../data/imports/worker");
let imports: typeof import("../../data/imports/imports");
let results: typeof import("../../data/imports/results");
let jev: typeof import("../../utils/pipelines/intake/models/jev");
let claude: typeof import("../../utils/pipelines/intake/models/claude");
let receiving: typeof import("../../utils/pipelines/receiving");
let pipeline: typeof import("../../utils/pipelines/intake");
let companies: typeof import("../../data/companies");

const invoice = sampleDocument("invoice");

async function drain() {
  while (await worker.runNextImport()) {}
}

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

function upload(file: Buffer | string, filename: string, request: Record<string, unknown> = {}, key: string | null = crypto.randomUUID()) {
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ companyId: COMPANY_ID, ...request })], { type: "application/json" }));
  form.append("file", new File([file], filename));
  return app.request("/api/v2/imports", { method: "POST", body: form, headers: key ? { "Idempotency-Key": key } : {} });
}

function inboundEmail(options: { messageId: string; to: string; attachments: { name: string; content: Buffer | string; type?: string }[]; subject?: string }) {
  return app.request("/api/v1/internal/postmark-inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-postmark-webhook-secret": "inbound-secret" },
    body: JSON.stringify({
      MessageID: options.messageId,
      OriginalRecipient: options.to,
      ToFull: [{ Email: options.to }],
      FromFull: { Email: "billing@supplier.example" },
      Subject: options.subject ?? "Your invoice",
      Date: "Mon, 2 Nov 2026 10:00:00 +0100",
      Headers: [{ Name: "Received-SPF", Value: "Pass (sender SPF authorized)" }],
      RawEmail: "From: billing@supplier.example\r\n\r\nbody",
      Attachments: options.attachments.map((attachment) => ({
        Name: attachment.name,
        Content: Buffer.from(attachment.content).toString("base64"),
        ContentType: attachment.type ?? "application/octet-stream",
      })),
    }),
  });
}

async function eventTypes(aggregateId?: string) {
  return (
    await rows<{ type: string; aggregate_id: string }>(
      `SELECT type, aggregate_id FROM events WHERE type LIKE 'peppol.import.%' OR type = 'peppol.document.received.v1' ORDER BY seq`,
    )
  )
    .filter((row) => !aggregateId || row.aggregate_id === aggregateId || row.type === "peppol.document.received.v1")
    .map((row) => row.type);
}

describe.skipIf(!testDatabaseUrl)("document intake against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    process.env.POSTMARK_INBOUND_WEBHOOK_SECRET = "inbound-secret";
    process.env.JWT_SECRET ??= "intake-test-secret";
    process.env.INBOUND_EMAIL_DOMAIN = "in.example.com";
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    const realS3 = await import("@core/lib/s3");
    mock.module("@core/lib/s3", () => ({
      ...realS3,
      isS3Enabled: () => true,
      uploadFile: async (key: string, data: Uint8Array | string) => {
        storage.set(key, Buffer.from(data));
        return key;
      },
      downloadBinaryFile: async (key: string) => {
        const bytes = storage.get(key);
        if (!bytes) throw new Error(`No object ${key}`);
        return bytes;
      },
      downloadTextFile: async (key: string) => storage.get(key)?.toString() ?? "",
      deleteFile: async (key: string) => {
        storage.delete(key);
      },
    }));
    mock.module("@peppol/data/validation/client", () => ({
      validateXmlDocument: async () => ({ result: "valid", errors: [] }),
    }));
    const realNotifications = await import("@peppol/data/send-document-notifications");
    mock.module("@peppol/data/send-document-notifications", () => ({
      ...realNotifications,
      sendIncomingDocumentNotifications: async (options: { transmittedDocumentId: string }) => {
        notifications.push(options);
      },
    }));
    const realTelegram = await import("@peppol/utils/system-notifications/telegram");
    mock.module("@peppol/utils/system-notifications/telegram", () => ({
      ...realTelegram,
      sendSystemAlert: (title: string) => {
        alerts.push(title);
      },
    }));
    mock.module("@core/lib/session", () => ({
      verifySession: async (c: { set: (key: string, value: unknown) => void }) => {
        c.set("user", { id: USER_ID, isAdmin: false });
        c.set("teamId", principal === "api_key" ? TEAM_ID : null);
        c.set("apiKey", principal === "api_key" ? { id: API_KEY_ID } : null);
        c.set("installation", null);
        c.set("service", null);
        return { userId: USER_ID, isAdmin: false, apiKey: principal === "api_key" ? { id: API_KEY_ID } : null };
      },
    }));

    // The tests run the worker themselves, so accepting an import does not start it.
    const realWorker = await import("@peppol/data/imports/worker");
    mock.module("@peppol/data/imports/worker", () => ({ ...realWorker, kickImportWorker: () => {} }));

    await import("../../lib/permissions");
    (await import("../../lib/event-types")).registerPeppolEventTypes();
    worker = await import("../../data/imports/worker");
    imports = await import("../../data/imports/imports");
    results = await import("../../data/imports/results");
    jev = await import("../../utils/pipelines/intake/models/jev");
    claude = await import("../../utils/pipelines/intake/models/claude");
    receiving = await import("../../utils/pipelines/receiving");
    pipeline = await import("../../utils/pipelines/intake");
    companies = await import("../../data/companies");
    app = new Hono();
    app.route("/api/v2/", (await import("../../api/v2/imports")).default);
    app.route("/api/v2/", (await import("../../api/v2/inbound-addresses")).default);
    app.route("/api/v2/", (await import("../../api/v2/files")).default);
    app.route("/api/v1/internal/", (await import("../../api/internal/postmark-inbound-webhook")).default);

    await seedTeamAndCompany(pool);
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'intake@example.com', 'x')`, [USER_ID]);
    await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, [TEAM_ID, USER_ID]);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country)
       VALUES ('cmp_second', $1, 'Second company', '2 Street', '1000', 'Brussels', 'BE')`,
      [TEAM_ID],
    );
    await pool.query(`INSERT INTO teams (id, name) VALUES ('team_other', 'Other team')`);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country)
       VALUES ('cmp_other', 'team_other', 'Other company', '1 Street', '1000', 'Brussels', 'BE')`,
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE peppol_import_attempts, peppol_import_results, peppol_files, peppol_imports, peppol_inbound_addresses,
                peppol_transmitted_documents, peppol_transfer_events, events, user_permissions, principal_permissions CASCADE`,
    );
    principal = "user";
    for (const permission of PERMISSIONS) {
      await pool.query(`INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES ($1, $2, $3)`, [USER_ID, TEAM_ID, permission]);
    }
    notifications.length = 0;
    alerts.length = 0;
    jev.setIntakeDecisionModelFactory(() => forbiddenDecisionModel);
    claude.setIntakeLanguageModelFactory(() => forbiddenLanguageModel());
  });

  describe("upload", () => {
    it("turns an uploaded XML invoice into an incoming document without a model", async () => {
      const response = await upload(invoice.xml, "invoice.xml", { metadata: { source: "test" } });
      expect(response.status).toBe(202);
      const accepted = await response.json();
      expect(response.headers.get("Location")).toBe(`/api/v2/imports/${accepted.id}`);
      expect(response.headers.get("X-Request-Id")).toStartWith("req_");
      expect(accepted).toMatchObject({ status: "queued", revision: 1, companyId: COMPANY_ID, resultCounts: { documents: 0, failed: 0 }, error: null });
      expect(accepted.source).toMatchObject({ channel: "api", requestId: response.headers.get("X-Request-Id") });
      expect(accepted.files).toEqual([{ id: expect.stringMatching(/^file_/), filename: "invoice.xml", mediaType: "application/xml", size: Buffer.byteLength(invoice.xml) }]);

      await drain();

      const finished = await (await app.request(`/api/v2/imports/${accepted.id}`)).json();
      expect(finished).toMatchObject({ status: "completed", revision: 3, resultCounts: { documents: 1, failed: 0 } });
      const page = await (await app.request(`/api/v2/imports/${accepted.id}/results`)).json();
      expect(page.nextCursor).toBeNull();
      expect(page.data).toEqual([
        { id: expect.stringMatching(/^res_/), locations: [{ fileId: accepted.files[0].id, role: "primary", range: null }], documentId: expect.stringMatching(/^doc_/), error: null },
      ]);
      const [document] = await rows(
        `SELECT type, source_channel, import_id, processing_method, sent_over_peppol, receiver_id, document_number, xml FROM peppol_transmitted_documents`,
      );
      expect(document).toMatchObject({
        type: "invoice",
        source_channel: "api",
        import_id: accepted.id,
        processing_method: "parsed",
        sent_over_peppol: false,
        document_number: invoice.number,
        xml: invoice.xml,
      });
      expect(await rows(`SELECT type, direction, ai_processed FROM peppol_transfer_events`)).toEqual([
        { type: "api", direction: "incoming", ai_processed: false },
      ]);
      expect(notifications).toHaveLength(1);
      // The last result and the end of the import are one revision, with only the finished event.
      expect(await eventTypes()).toEqual([
        "peppol.import.changed.v1",
        "peppol.import.changed.v1",
        "peppol.document.received.v1",
        "peppol.import.finished.v1",
      ]);
      const [received] = await rows<{ payload: Record<string, unknown> }>(`SELECT payload FROM events WHERE type = 'peppol.document.received.v1'`);
      expect(received.payload).toMatchObject({ channel: "api", importId: accepted.id, processingMethod: "parsed" });
    });

    it("replays the same key and request, and refuses the key for another request", async () => {
      const response = await upload(invoice.xml, "invoice.xml", {}, "key-1");
      const first = await response.json();
      expect(Date.parse(response.headers.get("Idempotency-Key-Expires-At")!)).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
      await drain();
      const replay = await upload(invoice.xml, "invoice.xml", {}, "key-1");
      expect(replay.status).toBe(202);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(replay.headers.get("Location")).toBe(`/api/v2/imports/${first.id}`);
      expect(replay.headers.get("Idempotency-Key-Expires-At")).not.toBeNull();
      // The replay is the response that accepted the import, not its state now.
      expect(await replay.json()).toEqual(first);
      const conflict = await upload(sampleDocument("creditNote").xml, "credit-note.xml", {}, "key-1");
      expect(conflict.status).toBe(409);
      expect(conflict.headers.get("Content-Type")).toContain("application/problem+json");
      expect(await conflict.json()).toMatchObject({ code: "idempotency_conflict", status: 409 });
      expect(await rows(`SELECT id FROM peppol_imports`)).toHaveLength(1);
      // A key belongs to the company it was used for: another company can use it too.
      const otherCompany = await upload(invoice.xml, "invoice.xml", { companyId: "cmp_second" }, "key-1");
      expect(otherCompany.status).toBe(202);
      expect(otherCompany.headers.get("Idempotency-Replayed")).toBeNull();
      expect(await rows(`SELECT id FROM peppol_imports`)).toHaveLength(2);
    });

    it("accepts a request without a key as a new import each time", async () => {
      const first = await upload(invoice.xml, "invoice.xml", {}, null);
      expect(first.status).toBe(202);
      expect(first.headers.get("Idempotency-Key-Expires-At")).toBeNull();
      const second = await upload(invoice.xml, "invoice.xml", {}, null);
      expect(second.status).toBe(202);
      expect(second.headers.get("Idempotency-Replayed")).toBeNull();
      expect((await second.json()).id).not.toBe((await first.json()).id);
      expect(await rows(`SELECT id FROM peppol_imports WHERE idempotency_key IS NULL`)).toHaveLength(2);
    });

    it("removes the stored bytes when the import cannot be inserted", async () => {
      await imports.acceptImport(
        { id: "imp_taken", teamId: TEAM_ID, companyId: COMPANY_ID, channel: "api", source: { channel: "api", requestId: "req_1" } },
        [],
      );
      const before = storage.size;
      await expect(
        imports.acceptImport(
          { id: "imp_taken", teamId: TEAM_ID, companyId: COMPANY_ID, channel: "api", source: { channel: "api", requestId: "req_2" } },
          [{ filename: "invoice.xml", mediaType: "application/xml", format: "ubl", bytes: Buffer.from(invoice.xml), provenance: { kind: "source" } }],
        ),
      ).rejects.toThrow();
      expect(storage.size).toBe(before);
    });

    it("lets an API key upload and read only with the permissions granted to it", async () => {
      principal = "api_key";
      expect((await upload(invoice.xml, "invoice.xml")).status).toBe(403);
      await pool.query(
        `INSERT INTO principal_permissions (principal_type, principal_id, team_id, permission_id) VALUES ('api_key', $1, $2, 'peppol.imports.write')`,
        [API_KEY_ID, TEAM_ID],
      );
      const accepted = await (await upload(invoice.xml, "invoice.xml")).json();
      expect(accepted.status).toBe("queued");
      expect((await app.request(`/api/v2/imports/${accepted.id}`)).status).toBe(403);
      await pool.query(
        `INSERT INTO principal_permissions (principal_type, principal_id, team_id, permission_id) VALUES ('api_key', $1, $2, 'peppol.imports.read')`,
        [API_KEY_ID, TEAM_ID],
      );
      expect((await app.request(`/api/v2/imports/${accepted.id}`)).status).toBe(200);
      // A key is bound to its team: a company of another team is not found.
      expect((await upload(invoice.xml, "invoice.xml", { companyId: "cmp_other" })).status).toBe(404);
      // A key has no more than its owner: without the member's permission, the grant does not count.
      await pool.query(`DELETE FROM user_permissions WHERE permission_id = 'peppol.imports.read'`);
      expect((await app.request(`/api/v2/imports/${accepted.id}`)).status).toBe(403);
    });

    it("checks access, permission and the file before accepting", async () => {
      await pool.query(`DELETE FROM user_permissions WHERE permission_id = 'peppol.imports.write'`);
      expect((await upload(invoice.xml, "invoice.xml")).status).toBe(403);
      await pool.query(`INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES ($1, $2, 'peppol.imports.write')`, [USER_ID, TEAM_ID]);
      expect((await upload(invoice.xml, "invoice.xml", { companyId: "cmp_other" })).status).toBe(404);
      expect((await upload(invoice.xml, "invoice.xml", { companyId: "cmp_missing" })).status).toBe(404);
      expect((await upload("plain text", "notes.txt")).status).toBe(415);
      expect(await (await upload(invoice.xml, "invoice.xml", { direction: "outgoing" })).json()).toMatchObject({ code: "unsupported_direction" });
      expect(await (await upload(buildPdf({ pages: ["x"] }), "a.pdf", { type: "messageLevelResponse" })).json()).toMatchObject({ code: "extraction_unsupported" });
      expect(await (await upload(invoice.xml, "invoice.xml", { labelIds: ["lbl_missing"] })).json()).toMatchObject({ code: "label_not_found" });
      expect(await (await upload(invoice.xml, "invoice.xml", { unexpected: true })).json()).toMatchObject({ code: "invalid_request" });
      expect(await rows(`SELECT id FROM peppol_imports`)).toHaveLength(0);
    });

    it("extracts a PDF with the models and bills it as AI processed", async () => {
      const decision = fakeDecisionModel(() => ({ invoice: 0.92, none: 0.08 }));
      jev.setIntakeDecisionModelFactory(() => decision.model);
      claude.setIntakeLanguageModelFactory(() => fakeLanguageModel({ document: invoice.document, findings: [], multipleDocuments: false }));
      const pdf = buildPdf({ pages: [invoiceViewText(invoice.document, invoice.number)] });
      const accepted = await (await upload(pdf, "purchase.pdf", { type: "invoice" })).json();

      await drain();

      expect((await imports.getImport(accepted.id))?.status).toBe("completed");
      const [document] = await rows<{ processing_method: string; parsed: { attachments: { filename: string }[] }; xml: string; findings: unknown[] }>(
        `SELECT processing_method, parsed, xml, findings FROM peppol_transmitted_documents`,
      );
      expect(document.processing_method).toBe("extracted");
      expect(document.xml).toContain(invoice.number);
      expect(document.parsed.attachments.map((attachment) => attachment.filename)).toContain("purchase.pdf");
      expect(await rows(`SELECT type, ai_processed FROM peppol_transfer_events`)).toEqual([{ type: "api", ai_processed: true }]);
      expect((await rows<{ stage: string }>(`SELECT stage, model FROM peppol_import_attempts ORDER BY started_at`)).map((row) => row.stage)).toEqual([
        "classify",
        "extract",
      ]);
    });

    it("parses the XML of a hybrid PDF without a model and keeps the PDF as its container", async () => {
      const cii = sampleDocument("invoice", "cii-d22b-en16931");
      const pdf = buildPdf({ pages: ["Invoice"], attachments: [{ name: "factur-x.xml", content: cii.xml }] });
      const accepted = await (await upload(pdf, "facturx.pdf")).json();

      await drain();

      const page = await (await app.request(`/api/v2/imports/${accepted.id}/results`)).json();
      expect(page.data[0].locations).toHaveLength(2);
      const derived = page.data[0].locations[1];
      const file = await (await app.request(`/api/v2/files/${derived.fileId}`)).json();
      expect(file).toMatchObject({ filename: "factur-x.xml", format: "cii", provenance: { kind: "derived", operation: "unwrap" } });
      const content = await app.request(`/api/v2/files/${derived.fileId}/content`);
      expect(await content.text()).toBe(cii.xml);
      expect(await rows(`SELECT processing_method, original_payload_location FROM peppol_transmitted_documents`)).toEqual([
        { processing_method: "parsed", original_payload_location: "s3" },
      ]);
      expect(await rows(`SELECT ai_processed FROM peppol_transfer_events`)).toEqual([{ ai_processed: false }]);
    });

    it("fails an import whose only file cannot be read, with no results", async () => {
      const accepted = await (await upload("%PDF-1.7 damaged", "broken.pdf")).json();
      await drain();
      const finished = await (await app.request(`/api/v2/imports/${accepted.id}`)).json();
      expect(finished).toMatchObject({ status: "failed", error: { code: "input_unreadable" }, resultCounts: { documents: 0, failed: 0 } });
      const [event] = await rows<{ payload: Record<string, unknown> }>(`SELECT payload FROM events WHERE type = 'peppol.import.finished.v1'`);
      expect(event.payload).toMatchObject({ status: "failed", failureCode: "input_unreadable" });
    });
  });

  describe("worker", () => {
    it("lets one worker hold an import until its lease ends", async () => {
      const accepted = await (await upload(invoice.xml, "invoice.xml")).json();
      const claimed = await worker.claimImport();
      expect(claimed?.id).toBe(accepted.id);
      expect(await worker.claimImport()).toBeNull();
      expect(await worker.claimImport({ excludeCompanyIds: [COMPANY_ID] })).toBeNull();
      await pool.query(`UPDATE peppol_imports SET lease_until = now() - interval '1 second'`);
      expect((await worker.claimImport())?.id).toBe(accepted.id);
    });

    it("retries from the last checkpoint, without asking a model again", async () => {
      const decision = fakeDecisionModel(() => ({ invoice: 0.9 }));
      jev.setIntakeDecisionModelFactory(() => decision.model);
      claude.setIntakeLanguageModelFactory(() => null);
      const pdf = buildPdf({ pages: [invoiceViewText(invoice.document, invoice.number)] });
      const accepted = await (await upload(pdf, "purchase.pdf")).json();

      await drain();

      const waiting = await imports.getImport(accepted.id);
      expect(waiting).toMatchObject({ status: "processing", attempts: 1, leaseUntil: null });
      expect(waiting!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(waiting!.lastError).toContain("No extraction model");

      await pool.query(`UPDATE peppol_imports SET next_attempt_at = now()`);
      claude.setIntakeLanguageModelFactory(() => fakeLanguageModel({ document: invoice.document, findings: [], multipleDocuments: false }));
      await drain();

      expect((await imports.getImport(accepted.id))?.status).toBe("completed");
      expect(decision.calls).toHaveLength(1);
    });

    it("counts a lost lease as a failed attempt, and gives up without running a stage after the last one", async () => {
      const decision = fakeDecisionModel(() => ({ invoice: 0.9 }));
      jev.setIntakeDecisionModelFactory(() => decision.model);
      claude.setIntakeLanguageModelFactory(() => null);
      const pdf = buildPdf({ pages: [invoiceViewText(invoice.document, invoice.number)] });
      const accepted = await (await upload(pdf, "crashing.pdf")).json();
      await drain();
      expect(await imports.getImport(accepted.id)).toMatchObject({ status: "processing", attempts: 1 });

      // A worker took the import and its process stopped before the import finished.
      await pool.query(`UPDATE peppol_imports SET lease_until = now() - interval '1 second', next_attempt_at = now()`);
      expect(await worker.claimImport()).toMatchObject({ id: accepted.id, attempts: 2, lastError: "The worker stopped before it finished the import" });

      await pool.query(`UPDATE peppol_imports SET lease_until = now() - interval '1 second', attempts = ${RETRY_BACKOFF_MS.length}`);
      claude.setIntakeLanguageModelFactory(() => fakeLanguageModel({ document: invoice.document, findings: [], multipleDocuments: false }));
      await drain();

      expect(await imports.getImport(accepted.id)).toMatchObject({ status: "failed", attempts: RETRY_BACKOFF_MS.length + 1, leaseUntil: null });
      const [result] = (await (await app.request(`/api/v2/imports/${accepted.id}/results`)).json()).data;
      expect(result).toMatchObject({ documentId: null, error: { code: "processing_unavailable" } });
      expect(decision.calls).toHaveLength(1);
      expect(await rows(`SELECT stage FROM peppol_import_attempts`)).toEqual([{ stage: "classify" }]);
    });

    it("leaves an import alone when its retry comes from a worker that another worker took the import from", async () => {
      jev.setIntakeDecisionModelFactory(() => fakeDecisionModel(() => ({ invoice: 0.9 })).model);
      claude.setIntakeLanguageModelFactory(() => null);
      const pdf = buildPdf({ pages: [invoiceViewText(invoice.document, invoice.number)] });
      const accepted = await (await upload(pdf, "taken-over.pdf")).json();
      const stale = (await worker.claimImport())!;

      // The first worker's lease runs out while it still works, and a second worker takes the import.
      await pool.query(`UPDATE peppol_imports SET lease_until = now() - interval '1 second'`);
      const current = (await worker.claimImport())!;
      expect(current).toMatchObject({ id: accepted.id, attempts: 1 });

      // The first worker then fails without an extraction model and tries to schedule a retry.
      await worker.processImport(stale);

      const row = await imports.getImport(accepted.id);
      expect(row).toMatchObject({ attempts: 1, lastError: "The worker stopped before it finished the import" });
      expect(row!.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(row!.nextAttemptAt.getTime()).toBe(current.nextAttemptAt.getTime());
    });

    it("fails a result at once when the model service refuses the document, and retries a service error", async () => {
      const refusal = (statusCode: number) =>
        new APICallError({ message: `HTTP ${statusCode}`, url: "https://gateway.example", requestBodyValues: {}, statusCode });
      const pdf = buildPdf({ pages: [invoiceViewText(invoice.document, invoice.number)] });
      let statusCode = 400;
      const model = {
        id: "refusing-model",
        decide: async () => {
          throw refusal(statusCode);
        },
      };
      jev.setIntakeDecisionModelFactory(() => model);

      const refused = await (await upload(pdf, "refused.pdf")).json();
      await drain();
      expect(await imports.getImport(refused.id)).toMatchObject({ status: "failed", attempts: 0, lastError: null });
      const [result] = (await (await app.request(`/api/v2/imports/${refused.id}/results`)).json()).data;
      expect(result.error).toMatchObject({ code: "input_rejected", context: { stage: "classify", statusCode: 400 } });
      expect(await rows(`SELECT stage, error FROM peppol_import_attempts`)).toEqual([{ stage: "classify", error: "HTTP 400" }]);

      statusCode = 503;
      const unavailable = await (await upload(pdf, "unavailable.pdf")).json();
      await drain();
      expect(await imports.getImport(unavailable.id)).toMatchObject({ status: "processing", attempts: 1, lastError: "HTTP 503" });
    });

    it("lets support retry a waiting import at once, and leaves a finished import final", async () => {
      jev.setIntakeDecisionModelFactory(() => null);
      const accepted = await (await upload(buildPdf({ pages: [invoiceViewText(invoice.document, invoice.number)] }), "a.pdf")).json();
      await drain();
      const waiting = await imports.getImport(accepted.id);
      expect(waiting).toMatchObject({ status: "processing", attempts: 1 });

      // While a worker holds the import, a restart does nothing: that worker schedules its own retry.
      await pool.query(`UPDATE peppol_imports SET next_attempt_at = now()`);
      expect(await worker.claimImport()).toMatchObject({ id: accepted.id, attempts: 1 });
      expect(await imports.restartImportRetries(accepted.id)).toBe(false);
      expect(await imports.getImport(accepted.id)).toMatchObject({ attempts: 1, lastError: waiting!.lastError });
      await pool.query(`UPDATE peppol_imports SET lease_until = NULL`);

      // A restart changes the worker state only: no revision and no event.
      expect(await imports.restartImportRetries(accepted.id)).toBe(true);
      const restarted = await imports.getImport(accepted.id);
      expect(restarted).toMatchObject({ attempts: 0, lastError: null, revision: waiting!.revision });
      expect(restarted!.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(await eventTypes(accepted.id)).toEqual(["peppol.import.changed.v1", "peppol.import.changed.v1"]);

      for (let attempt = 0; attempt <= 5; attempt++) {
        await drain();
        await pool.query(`UPDATE peppol_imports SET next_attempt_at = now()`);
      }
      const failedImport = await (await app.request(`/api/v2/imports/${accepted.id}`)).json();
      expect(failedImport).toMatchObject({ status: "failed", resultCounts: { documents: 0, failed: 1 } });
      const [failedResult] = (await (await app.request(`/api/v2/imports/${accepted.id}/results`)).json()).data;
      expect(failedResult.error.code).toBe("processing_unavailable");
      expect(await imports.restartImportRetries(accepted.id)).toBe(false);
      expect((await eventTypes(accepted.id)).filter((type) => type === "peppol.import.finished.v1")).toHaveLength(1);
    });

    it("fails the whole import when its files stay unavailable", async () => {
      const accepted = await (await upload(invoice.xml, "invoice.xml")).json();
      const [{ s3_key: key }] = await rows<{ s3_key: string }>(`SELECT s3_key FROM peppol_files`);
      storage.delete(key);
      for (let attempt = 0; attempt <= 5; attempt++) {
        await drain();
        await pool.query(`UPDATE peppol_imports SET next_attempt_at = now()`);
      }
      expect(await (await app.request(`/api/v2/imports/${accepted.id}`)).json()).toMatchObject({
        status: "failed",
        error: { code: "processing_unavailable" },
        resultCounts: { documents: 0, failed: 0 },
      });
    });

    it("publishes a result once, also when a second worker runs it after a lost lease", async () => {
      const accepted = await (await upload(invoice.xml, "invoice.xml")).json();
      await drain();
      const importRow = (await imports.getImport(accepted.id))!;
      const [result] = await results.getImportResults(accepted.id);
      // The state a worker had before its lease ran out and another worker finished the import.
      const stale = { ...result, status: "pending" as const, checkpoints: {} };
      const context = pipeline.createResultContext({
        importRow,
        company: (await companies.getCompanyById(COMPANY_ID))!,
        result: stale,
        files: await (await import("../../data/imports/files")).getImportFiles(accepted.id),
      });
      await expect(pipeline.runResult(context)).rejects.toBeInstanceOf(results.ResultNotPendingError);
      expect(await rows(`SELECT id FROM peppol_transmitted_documents`)).toHaveLength(1);
      expect(await rows(`SELECT id FROM peppol_transfer_events`)).toHaveLength(1);
      expect((await imports.getImport(accepted.id))?.revision).toBe(importRow.revision);
    });

    it("gives results their sequence in the order they are published", async () => {
      const accepted = await (await upload(invoice.xml, "invoice.xml")).json();
      const files = await rows<{ id: string }>(`SELECT id FROM peppol_files`);
      const [first, second] = await results.savePlannedResults(accepted.id, [
        { locations: [{ fileId: files[0].id, role: "primary", range: null }] },
        { locations: [{ fileId: files[0].id, role: "primary", range: null }] },
      ]);
      await results.publishFailedResult(accepted.id, second.id, { code: "file_unreadable", message: "x" });
      await results.publishFailedResult(accepted.id, first.id, { code: "file_unreadable", message: "y" });
      await expect(results.publishFailedResult(accepted.id, first.id, { code: "file_unreadable", message: "z" })).rejects.toBeInstanceOf(
        results.ResultNotPendingError,
      );
      const page = await (await app.request(`/api/v2/imports/${accepted.id}/results?limit=1`)).json();
      expect(page.data.map((result: { id: string }) => result.id)).toEqual([second.id]);
      const next = await (await app.request(`/api/v2/imports/${accepted.id}/results?limit=1&cursor=${page.nextCursor}`)).json();
      expect(next.data.map((result: { id: string }) => result.id)).toEqual([first.id]);
      expect((await app.request(`/api/v2/imports/${accepted.id}/results?cursor=nonsense`)).status).toBe(400);
      // A well-formed cursor for this list, but with a position that is not a sequence.
      const decoded = JSON.parse(Buffer.from(page.nextCursor, "base64url").toString("utf8"));
      for (const position of ["abc", 1.5, 2 ** 40]) {
        const tampered = Buffer.from(JSON.stringify({ ...decoded, p: position })).toString("base64url");
        const response = await app.request(`/api/v2/imports/${accepted.id}/results?cursor=${tampered}`);
        expect(response.status).toBe(400);
        expect((await response.json()).code).toBe("invalid_cursor");
      }
    });
  });

  describe("lists", () => {
    // Rows made in the same millisecond, a few microseconds apart: a JavaScript Date
    // cannot hold that difference, so paging must not depend on it.
    async function sameMillisecond(table: string) {
      await pool.query(
        `UPDATE ${table} SET created_at = '2026-11-02T10:00:00.123000Z'::timestamptz + (random() * 900) * interval '1 microsecond'`,
      );
    }

    async function pageThrough(path: string) {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const separator = path.includes("?") ? "&" : "?";
        const response = await app.request(`${path}${separator}limit=1${cursor ? `&cursor=${cursor}` : ""}`);
        const body = (await response.json()) as { data: { id: string }[]; nextCursor: string | null };
        ids.push(...body.data.map((item) => item.id));
        cursor = body.nextCursor;
      } while (cursor);
      return ids;
    }

    it("pages through imports made in the same millisecond without skipping one", async () => {
      for (let n = 0; n < 4; n++) {
        await upload(invoice.xml, `invoice-${n}.xml`);
      }
      await sameMillisecond("peppol_imports");
      const ids = (await rows<{ id: string }>(`SELECT id FROM peppol_imports ORDER BY id DESC`)).map((row) => row.id);
      expect(await pageThrough(`/api/v2/imports?companyId=${COMPANY_ID}`)).toEqual(ids);
    });

    it("lists the imports of the team, or of the companies asked for", async () => {
      const first = await (await upload(invoice.xml, "first.xml")).json();
      const second = await (await upload(invoice.xml, "second.xml", { companyId: "cmp_second" })).json();
      const ids = async (query: string) =>
        ((await (await app.request(`/api/v2/imports?${query}`)).json()) as { data: { id: string }[] }).data.map((row) => row.id);

      // A user session is not bound to one team.
      expect(await (await app.request("/api/v2/imports")).json()).toMatchObject({ code: "invalid_request" });
      expect(await ids(`teamId=${TEAM_ID}`)).toEqual([second.id, first.id]);
      expect(await ids(`companyId=cmp_second`)).toEqual([second.id]);
      expect(await ids(`teamId=${TEAM_ID}&companyId=${COMPANY_ID},cmp_second`)).toEqual([second.id, first.id]);
      expect((await app.request(`/api/v2/imports?teamId=team_other`)).status).toBe(404);
      expect((await app.request(`/api/v2/imports?companyId=${COMPANY_ID},cmp_other`)).status).toBe(404);
      expect((await app.request(`/api/v2/imports?teamId=team_other&companyId=${COMPANY_ID}`)).status).toBe(400);

      // An API key lists its own team, and only with the read permission.
      principal = "api_key";
      expect((await app.request("/api/v2/imports")).status).toBe(403);
      await pool.query(
        `INSERT INTO principal_permissions (principal_type, principal_id, team_id, permission_id) VALUES ('api_key', $1, $2, 'peppol.imports.read')`,
        [API_KEY_ID, TEAM_ID],
      );
      expect(await ids("")).toEqual([second.id, first.id]);
      expect((await app.request(`/api/v2/imports?teamId=team_other`)).status).toBe(404);
    });

    it("pages through inbound addresses made in the same millisecond without skipping one", async () => {
      for (let n = 0; n < 4; n++) {
        await app.request(`/api/v2/companies/${COMPANY_ID}/email/inbound-addresses`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: "{}",
        });
      }
      await sameMillisecond("peppol_inbound_addresses");
      const ids = (await rows<{ id: string }>(`SELECT id FROM peppol_inbound_addresses ORDER BY id DESC`)).map((row) => row.id);
      expect(ids).toHaveLength(4);
      expect(await pageThrough(`/api/v2/companies/${COMPANY_ID}/email/inbound-addresses`)).toEqual(ids);
    });
  });

  describe("deletion", () => {
    it("deletes a finished import only, and keeps its documents", async () => {
      const accepted = await (await upload(invoice.xml, "invoice.xml")).json();
      const inProgress = await app.request(`/api/v2/imports/${accepted.id}`, { method: "DELETE" });
      expect(inProgress.status).toBe(409);
      expect(await inProgress.json()).toMatchObject({ code: "import_in_progress" });

      await drain();
      expect((await app.request(`/api/v2/imports/${accepted.id}`, { method: "DELETE" })).status).toBe(204);
      expect((await app.request(`/api/v2/imports/${accepted.id}`, { method: "DELETE" })).status).toBe(204);
      const gone = await app.request(`/api/v2/imports/${accepted.id}`);
      expect(gone.status).toBe(410);
      expect(await gone.json()).toMatchObject({ code: "resource_deleted", context: { reason: "deleted", revision: 4 } });
      expect((await app.request(`/api/v2/files/${accepted.files[0].id}`)).status).toBe(410);
      expect((await app.request(`/api/v2/files/${accepted.files[0].id}/content`)).status).toBe(410);
      const list = await (await app.request(`/api/v2/imports?companyId=${COMPANY_ID}`)).json();
      expect(list.data).toEqual([]);
      expect(await rows(`SELECT id FROM peppol_transmitted_documents`)).toHaveLength(1);
      expect((await eventTypes(accepted.id)).at(-1)).toBe("peppol.import.deleted.v1");
      const [deleted] = await rows<{ payload: Record<string, unknown> }>(`SELECT payload FROM events WHERE type = 'peppol.import.deleted.v1'`);
      expect(deleted.payload).toMatchObject({ importId: accepted.id, revision: 4, reason: "deleted", deletedAt: expect.any(String) });
    });

    it("serves files only to callers who may read the company's imports", async () => {
      await pool.query(
        `INSERT INTO peppol_imports (id, team_id, company_id, channel, source, status) VALUES ('imp_other', 'team_other', 'cmp_other', 'api', '{"channel":"api","requestId":"req_x"}', 'completed')`,
      );
      await pool.query(
        `INSERT INTO peppol_files (id, team_id, company_id, import_id, filename, media_type, size, sha256, s3_key, provenance)
         VALUES ('file_other', 'team_other', 'cmp_other', 'imp_other', 'secret.pdf', 'application/pdf', 4, 'x', 'other/key', '{"kind":"source"}')`,
      );
      storage.set("other/key", Buffer.from("%PDF"));
      expect((await app.request(`/api/v2/files/file_other`)).status).toBe(404);
      expect((await app.request(`/api/v2/files/file_other/content`)).status).toBe(404);
      expect((await app.request(`/api/v2/files/file_missing`)).status).toBe(404);

      const accepted = await (await upload(invoice.xml, "invoice.xml")).json();
      await pool.query(`DELETE FROM user_permissions WHERE permission_id = 'peppol.imports.read'`);
      expect((await app.request(`/api/v2/files/${accepted.files[0].id}`)).status).toBe(403);
      expect((await app.request(`/api/v2/files/${accepted.files[0].id}/content`)).status).toBe(403);
    });

    it("downloads a file whose name has characters outside Latin-1", async () => {
      const name = "請求書 – März.xml";
      const accepted = await (await upload(invoice.xml, name)).json();
      const content = await app.request(`/api/v2/files/${accepted.files[0].id}/content`);
      expect(content.status).toBe(200);
      expect(content.headers.get("Content-Disposition")).toBe(
        `attachment; filename="___ _ M_rz.xml"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      expect(await content.text()).toBe(invoice.xml);
    });
  });

  describe("email", () => {
    async function createAddress(body: Record<string, unknown> = {}, key: string = crypto.randomUUID()) {
      return app.request(`/api/v2/companies/${COMPANY_ID}/email/inbound-addresses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
    }

    it("manages inbound addresses", async () => {
      const created = await createAddress({}, "address-key");
      expect(created.status).toBe(202);
      const address = await created.json();
      expect(address).toMatchObject({ companyId: COMPANY_ID, enabled: true, status: "active", acceptedTypes: null, revision: 1 });
      expect(address.address).toMatch(/^[a-z2-7]{16}@in\.example\.com$/);
      expect(created.headers.get("Location")).toBe(`/api/v2/companies/${COMPANY_ID}/email/inbound-addresses/${address.id}`);
      expect(created.headers.get("ETag")).toBe(`"1"`);
      expect(created.headers.get("Idempotency-Key-Expires-At")).not.toBeNull();

      const path = `/api/v2/companies/${COMPANY_ID}/email/inbound-addresses/${address.id}`;
      const patch = (body: unknown, ifMatch?: string) =>
        app.request(path, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...(ifMatch ? { "If-Match": ifMatch } : {}) },
          body: JSON.stringify(body),
        });
      const stale = await patch({ enabled: false }, `"7"`);
      expect(stale.status).toBe(412);
      expect(await stale.json()).toMatchObject({ code: "precondition_failed" });
      const patched = await patch({ enabled: false, acceptedTypes: ["invoice"] }, `"1"`);
      expect(patched.headers.get("ETag")).toBe(`"2"`);
      expect(await patched.json()).toMatchObject({ enabled: false, status: "disabled", acceptedTypes: ["invoice"], revision: 2 });
      expect((await patch({ enabled: true })).status).toBe(200);
      expect((await app.request(path)).headers.get("ETag")).toBe(`"3"`);
      // Setting the values the address already has changes nothing: no revision, no event.
      for (const body of [{ enabled: true }, { acceptedTypes: ["invoice", "invoice"] }]) {
        const unchanged = await patch(body, `"3"`);
        expect(unchanged.status).toBe(200);
        expect(unchanged.headers.get("ETag")).toBe(`"3"`);
        expect(await unchanged.json()).toMatchObject({ enabled: true, acceptedTypes: ["invoice"], revision: 3 });
      }

      // A replay gives the response that created the address, not its state now.
      const replay = await createAddress({}, "address-key");
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(replay.headers.get("ETag")).toBe(`"1"`);
      expect(await replay.json()).toEqual(address);
      expect((await (await app.request(`/api/v2/companies/${COMPANY_ID}/email/inbound-addresses`)).json()).data).toHaveLength(1);

      await pool.query(`DELETE FROM user_permissions WHERE permission_id = 'peppol.inbound_addresses.manage'`);
      expect((await app.request(path, { method: "DELETE" })).status).toBe(403);
      await pool.query(`INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES ($1, $2, 'peppol.inbound_addresses.manage')`, [USER_ID, TEAM_ID]);
      expect((await app.request(path, { method: "DELETE", headers: { "If-Match": `"1"` } })).status).toBe(412);
      expect((await app.request(path, { method: "DELETE" })).status).toBe(204);
      expect((await app.request(path, { method: "DELETE" })).status).toBe(204);
      expect((await app.request(path)).status).toBe(410);
      expect((await app.request(`/api/v2/companies/cmp_other/email/inbound-addresses`)).status).toBe(404);

      const events = await rows<{ type: string; payload: Record<string, unknown> }>(
        `SELECT type, payload FROM events WHERE aggregate_id = $1 ORDER BY seq`,
        [address.id],
      );
      expect(events.map((event) => [event.type, event.payload.revision])).toEqual([
        ["peppol.inbound_address.changed.v1", 1],
        ["peppol.inbound_address.changed.v1", 2],
        ["peppol.inbound_address.changed.v1", 3],
        ["peppol.inbound_address.deleted.v1", 4],
      ]);
      expect(events[1].payload).toMatchObject({ enabled: false, status: "disabled", acceptedTypes: ["invoice"] });
      expect(events[3].payload).toMatchObject({ reason: "deleted", deletedAt: expect.any(String) });
    });

    it("imports an email once, pairs an XML invoice with its PDF view and skips other attachments", async () => {
      const address = await (await createAddress()).json();
      const view = buildPdf({ pages: [invoiceViewText(invoice.document, invoice.number)] });
      const email = {
        messageId: "message-1",
        to: address.address,
        attachments: [
          { name: "invoice.xml", content: invoice.xml },
          { name: "invoice.pdf", content: view },
          { name: "logo.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
        ],
      };
      expect((await inboundEmail(email)).status).toBe(200);
      expect((await inboundEmail(email)).status).toBe(200);
      const [row] = await rows<{ id: string; source: Record<string, unknown> }>(`SELECT id, source FROM peppol_imports`);
      expect(await rows(`SELECT id FROM peppol_imports`)).toHaveLength(1);
      expect(row.source).toMatchObject({ channel: "email", from: "billing@supplier.example", to: address.address, authentication: { spf: "pass" } });

      await drain();

      const finished = await (await app.request(`/api/v2/imports/${row.id}`)).json();
      expect(finished).toMatchObject({ status: "completed", resultCounts: { documents: 1, failed: 0 } });
      expect(finished.files.map((file: { filename: string }) => file.filename)).toEqual(["message.eml", "invoice.xml", "invoice.pdf"]);
      const [result] = (await (await app.request(`/api/v2/imports/${row.id}/results`)).json()).data;
      expect(result.locations.map((location: { role: string }) => location.role)).toEqual(["primary", "supporting"]);
      expect(await rows(`SELECT source_channel, processing_method FROM peppol_transmitted_documents`)).toEqual([
        { source_channel: "email", processing_method: "parsed" },
      ]);
      expect(await rows(`SELECT type FROM peppol_transfer_events`)).toEqual([{ type: "email" }]);
    });

    it("extracts a scanned PDF next to its XML, and does not publish the same document twice", async () => {
      // A scan has no text layer, so Claude classifies it instead of Jev, then extracts it.
      const model = fakeLanguageModel({ result: "Invoice" }, { document: invoice.document, findings: [], multipleDocuments: false });
      claude.setIntakeLanguageModelFactory(() => model);
      const address = await (await createAddress()).json();
      await inboundEmail({
        messageId: "scan-1",
        to: address.address,
        attachments: [
          { name: "invoice.xml", content: invoice.xml },
          // A scan has no text layer, so nothing proves it shows the XML before extraction.
          { name: "scan.pdf", content: buildPdf({ pages: [""] }) },
        ],
      });

      await drain();

      const [row] = await rows<{ id: string }>(`SELECT id FROM peppol_imports`);
      expect(await (await app.request(`/api/v2/imports/${row.id}`)).json()).toMatchObject({
        status: "completed",
        resultCounts: { documents: 1, failed: 0 },
      });
      expect(await rows(`SELECT status, position FROM peppol_import_results ORDER BY position`)).toEqual([
        { status: "document", position: 0 },
        { status: "ignored", position: 1 },
      ]);
      expect((await (await app.request(`/api/v2/imports/${row.id}/results`)).json()).data).toHaveLength(1);
      expect(await rows(`SELECT processing_method FROM peppol_transmitted_documents`)).toEqual([{ processing_method: "parsed" }]);
      expect(model.doGenerateCalls).toHaveLength(2);
      expect(await rows(`SELECT ai_processed FROM peppol_transfer_events`)).toEqual([{ ai_processed: false }]);
    });

    it("does not publish a hybrid PDF again next to its own XML when its text does not prove the pair", async () => {
      const cii = sampleDocument("invoice", "cii-d22b-en16931");
      const address = await (await createAddress()).json();
      await inboundEmail({
        messageId: "hybrid-1",
        to: address.address,
        attachments: [
          { name: "invoice.xml", content: cii.xml },
          // The text layer shows no number, date or amount, so plan cannot pair the two files.
          { name: "invoice.pdf", content: buildPdf({ pages: ["Invoice"], attachments: [{ name: "factur-x.xml", content: cii.xml }] }) },
        ],
      });

      await drain();

      const [row] = await rows<{ id: string }>(`SELECT id FROM peppol_imports`);
      expect(await (await app.request(`/api/v2/imports/${row.id}`)).json()).toMatchObject({
        status: "completed",
        resultCounts: { documents: 1, failed: 0 },
      });
      expect(await rows(`SELECT status, position FROM peppol_import_results ORDER BY position`)).toEqual([
        { status: "document", position: 0 },
        { status: "ignored", position: 1 },
      ]);
      expect(await rows(`SELECT processing_method, original_payload_location FROM peppol_transmitted_documents`)).toEqual([
        { processing_method: "parsed", original_payload_location: "none" },
      ]);
      expect(await rows(`SELECT ai_processed FROM peppol_transfer_events`)).toEqual([{ ai_processed: false }]);
      expect((await eventTypes()).filter((type) => type === "peppol.document.received.v1")).toHaveLength(1);
    });

    it("stores the XML of a hybrid PDF once when a retry runs it again next to an identical XML file", async () => {
      const cii = sampleDocument("invoice", "cii-d22b-en16931");
      const address = await (await createAddress()).json();
      await inboundEmail({
        messageId: "hybrid-retry",
        to: address.address,
        attachments: [
          { name: "invoice.xml", content: cii.xml },
          { name: "invoice.pdf", content: buildPdf({ pages: ["Invoice"], attachments: [{ name: "factur-x.xml", content: cii.xml }] }) },
        ],
      });
      await drain();
      const [row] = await rows<{ id: string }>(`SELECT id FROM peppol_imports`);
      const importRow = (await imports.getImport(row.id))!;
      const hybrid = (await results.getImportResults(row.id))[1];
      // A second worker that starts the hybrid PDF again from its first stage, after the first one stored the XML.
      const context = pipeline.createResultContext({
        importRow,
        company: (await companies.getCompanyById(COMPANY_ID))!,
        result: { ...hybrid, status: "pending" as const, checkpoints: {} },
        files: await (await import("../../data/imports/files")).getImportFiles(row.id),
      });
      await expect(pipeline.runResult(context)).rejects.toBeInstanceOf(results.ResultNotPendingError);

      expect(await rows(`SELECT filename FROM peppol_files WHERE provenance->>'kind' = 'derived'`)).toEqual([{ filename: "factur-x.xml" }]);
    });

    it("publishes one document for an XML file attached twice", async () => {
      const address = await (await createAddress()).json();
      await inboundEmail({
        messageId: "twice-xml",
        to: address.address,
        attachments: [
          { name: "invoice.xml", content: invoice.xml },
          { name: "invoice-copy.xml", content: invoice.xml },
        ],
      });

      await drain();

      const [row] = await rows<{ id: string }>(`SELECT id FROM peppol_imports`);
      expect(await (await app.request(`/api/v2/imports/${row.id}`)).json()).toMatchObject({
        status: "completed",
        resultCounts: { documents: 1, failed: 0 },
      });
      const [result, ...others] = (await (await app.request(`/api/v2/imports/${row.id}/results`)).json()).data;
      expect(others).toEqual([]);
      expect(result.locations.map((location: { role: string }) => location.role)).toEqual(["primary", "supporting"]);
      expect(await rows(`SELECT processing_method FROM peppol_transmitted_documents`)).toEqual([{ processing_method: "parsed" }]);
      expect(await rows(`SELECT ai_processed FROM peppol_transfer_events`)).toEqual([{ ai_processed: false }]);
      expect((await eventTypes()).filter((type) => type === "peppol.document.received.v1")).toHaveLength(1);
    });

    it("extracts a scanned PDF attached twice once, with one model call per stage", async () => {
      // A scan has no text layer, so Claude classifies it instead of Jev, then extracts it.
      const model = fakeLanguageModel({ result: "Invoice" }, { document: invoice.document, findings: [], multipleDocuments: false });
      claude.setIntakeLanguageModelFactory(() => model);
      const address = await (await createAddress()).json();
      const scan = buildPdf({ pages: [""] });
      await inboundEmail({
        messageId: "twice-scan",
        to: address.address,
        attachments: [
          { name: "scan.pdf", content: scan },
          { name: "scan-copy.pdf", content: scan },
        ],
      });

      await drain();

      const [row] = await rows<{ id: string }>(`SELECT id FROM peppol_imports`);
      expect(await (await app.request(`/api/v2/imports/${row.id}`)).json()).toMatchObject({
        status: "completed",
        resultCounts: { documents: 1, failed: 0 },
      });
      expect(await rows(`SELECT status FROM peppol_import_results`)).toEqual([{ status: "document" }]);
      expect(await rows(`SELECT processing_method FROM peppol_transmitted_documents`)).toEqual([{ processing_method: "extracted" }]);
      expect(await rows(`SELECT ai_processed FROM peppol_transfer_events`)).toEqual([{ ai_processed: true }]);
      expect(model.doGenerateCalls).toHaveLength(2);
      expect((await rows<{ stage: string }>(`SELECT stage FROM peppol_import_attempts ORDER BY started_at`)).map((attempt) => attempt.stage)).toEqual([
        "classify",
        "extract",
      ]);
    });

    it("pairs a PDF view with a hybrid PDF that comes after it, without a model call", async () => {
      const cii = sampleDocument("invoice", "cii-d22b-en16931");
      const address = await (await createAddress()).json();
      await inboundEmail({
        messageId: "view-then-hybrid",
        to: address.address,
        attachments: [
          { name: "invoice-copy.pdf", content: buildPdf({ pages: [invoiceViewText(cii.document, cii.number)] }) },
          { name: "invoice.pdf", content: buildPdf({ pages: ["Invoice"], attachments: [{ name: "factur-x.xml", content: cii.xml }] }) },
        ],
      });

      await drain();

      const [row] = await rows<{ id: string }>(`SELECT id FROM peppol_imports`);
      const [result, ...others] = (await (await app.request(`/api/v2/imports/${row.id}/results`)).json()).data;
      expect(others).toEqual([]);
      const files = (await (await app.request(`/api/v2/imports/${row.id}`)).json()).files as { id: string; filename: string }[];
      const filename = (fileId: string) => files.find((file) => file.id === fileId)?.filename;
      expect(result.locations.map((location: { fileId: string; role: string }) => [filename(location.fileId), location.role])).toEqual([
        ["invoice.pdf", "primary"],
        ["invoice-copy.pdf", "supporting"],
        ["factur-x.xml", "supporting"],
      ]);
      expect(await rows(`SELECT processing_method FROM peppol_transmitted_documents`)).toEqual([{ processing_method: "parsed" }]);
      expect(await rows(`SELECT ai_processed FROM peppol_transfer_events`)).toEqual([{ ai_processed: false }]);
    });

    it("checks a scanned PDF against a hybrid PDF that comes after it", async () => {
      const cii = sampleDocument("invoice", "cii-d22b-en16931");
      // A scan has no text layer, so Claude classifies it instead of Jev, then extracts it.
      const model = fakeLanguageModel({ result: "Invoice" }, { document: cii.document, findings: [], multipleDocuments: false });
      claude.setIntakeLanguageModelFactory(() => model);
      const address = await (await createAddress()).json();
      await inboundEmail({
        messageId: "scan-then-hybrid",
        to: address.address,
        attachments: [
          { name: "scan.pdf", content: buildPdf({ pages: [""] }) },
          { name: "invoice.pdf", content: buildPdf({ pages: ["Invoice"], attachments: [{ name: "factur-x.xml", content: cii.xml }] }) },
        ],
      });

      await drain();

      const [row] = await rows<{ id: string }>(`SELECT id FROM peppol_imports`);
      expect(await (await app.request(`/api/v2/imports/${row.id}`)).json()).toMatchObject({
        status: "completed",
        resultCounts: { documents: 1, failed: 0 },
      });
      // The hybrid PDF is planned first, so the scan is checked against its published document.
      expect(await rows(`SELECT status, position FROM peppol_import_results ORDER BY position`)).toEqual([
        { status: "document", position: 0 },
        { status: "ignored", position: 1 },
      ]);
      expect(await rows(`SELECT processing_method FROM peppol_transmitted_documents`)).toEqual([{ processing_method: "parsed" }]);
      expect(await rows(`SELECT ai_processed FROM peppol_transfer_events`)).toEqual([{ ai_processed: false }]);
      expect((await eventTypes()).filter((type) => type === "peppol.document.received.v1")).toHaveLength(1);
    });

    it("fails an emailed PDF over the page limit without a model call", async () => {
      const address = await (await createAddress()).json();
      const pages = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, page) => `Page ${page + 1}`);
      await inboundEmail({ messageId: "long-1", to: address.address, attachments: [{ name: "long.pdf", content: buildPdf({ pages }) }] });

      await drain();

      const [row] = await rows<{ id: string }>(`SELECT id FROM peppol_imports`);
      expect(await (await app.request(`/api/v2/imports/${row.id}`)).json()).toMatchObject({ status: "failed", resultCounts: { failed: 1 } });
      const [result] = (await (await app.request(`/api/v2/imports/${row.id}/results`)).json()).data;
      expect(result.error).toMatchObject({ code: "page_limit_exceeded", context: { pageCount: MAX_PDF_PAGES + 1 } });
      expect(await rows(`SELECT id FROM peppol_import_attempts`)).toHaveLength(0);
    });

    it("refuses an unknown or disabled address", async () => {
      expect((await inboundEmail({ messageId: "m", to: "nobody@in.example.com", attachments: [] })).status).toBe(403);
      const address = await (await createAddress({ enabled: false })).json();
      expect((await inboundEmail({ messageId: "m", to: address.address, attachments: [] })).status).toBe(403);
      expect(await rows(`SELECT id FROM peppol_imports`)).toHaveLength(0);
    });

    it("ignores a newsletter and an email without documents", async () => {
      jev.setIntakeDecisionModelFactory(() => fakeDecisionModel(() => ({ none: 0.95 })).model);
      const address = await (await createAddress()).json();
      await inboundEmail({ messageId: "newsletter", to: address.address, attachments: [{ name: "news.pdf", content: buildPdf({ pages: ["Our monthly newsletter"] }) }] });
      await inboundEmail({ messageId: "empty", to: address.address, attachments: [] });
      await drain();
      expect(await rows(`SELECT status, document_count, failed_count FROM peppol_imports`)).toEqual([
        { status: "ignored", document_count: 0, failed_count: 0 },
        { status: "ignored", document_count: 0, failed_count: 0 },
      ]);
      const listed = await (await app.request(`/api/v2/imports?companyId=${COMPANY_ID}&statuses=ignored`)).json();
      expect(listed.data).toHaveLength(2);
      for (const listedImport of listed.data) {
        expect((await (await app.request(`/api/v2/imports/${listedImport.id}/results`)).json()).data).toEqual([]);
      }
    });
  });

  describe("Peppol receiving", () => {
    beforeAll(async () => {
      await pool.query(`INSERT INTO peppol_labels (id, team_id, name, color_hex) VALUES ('lbl_supplier', $1, 'Supplier', '#000000')`, [TEAM_ID]);
      await pool.query(
        `INSERT INTO supporting_data_suppliers (id, team_id, name, peppol_addresses) VALUES ('sd_supp_intake', $1, 'Supplier', ARRAY['0208:1234567894'])`,
        [TEAM_ID],
      );
      await pool.query(`INSERT INTO supporting_data_supplier_labels (supporting_data_supplier_id, label_id) VALUES ('sd_supp_intake', 'lbl_supplier')`);
      await pool.query(`UPDATE peppol_companies SET is_smp_recipient = true WHERE id = $1`, [COMPANY_ID]);
      await pool.query(
        `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('cid_intake', $1, '0208', '0598726857')`,
        [COMPANY_ID],
      );
    });

    it("records a received document, its event and its usage as before", async () => {
      await receiving.receivingPipeline({
        senderId: "iso6523-actorid-upis::0208:1234567894",
        receiverId: "0208:0598726857",
        docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
        processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
        countryC1: "BE",
        body: invoice.xml,
        contentType: "application/xml",
        as4MessageId: "as4-1",
      });
      expect(await rows(`SELECT type, sender_id, receiver_id, sent_over_peppol, source_channel, processing_method, peppol_message_id FROM peppol_transmitted_documents`)).toEqual([
        { type: "invoice", sender_id: "0208:1234567894", receiver_id: "0208:0598726857", sent_over_peppol: true, source_channel: null, processing_method: null, peppol_message_id: "as4-1" },
      ]);
      expect(await rows(`SELECT type, direction, ai_processed FROM peppol_transfer_events`)).toEqual([{ type: "peppol", direction: "incoming", ai_processed: false }]);
      const [event] = await rows<{ payload: Record<string, unknown> }>(`SELECT payload FROM events WHERE type = 'peppol.document.received.v1'`);
      expect(event.payload.channel).toBeUndefined();
      expect(notifications).toHaveLength(1);
      expect(await rows(`SELECT label_id FROM peppol_transmitted_document_labels`)).toEqual([{ label_id: "lbl_supplier" }]);
    });

    it("keeps a document that does not decode as unknown, and reports it", async () => {
      await receiving.receivingPipeline({
        senderId: "0208:1234567894",
        receiverId: "0208:0598726857",
        docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
        processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
        countryC1: "BE",
        body: invoice.xml.replace(/<cac:InvoiceLine>[\s\S]*<\/cac:InvoiceLine>/, ""),
        contentType: "application/xml",
      });
      expect(await rows(`SELECT type FROM peppol_transmitted_documents`)).toEqual([{ type: "unknown" }]);
      expect(alerts).toContain("Document Parsing Error");
      expect(await rows(`SELECT type FROM peppol_transfer_events`)).toEqual([{ type: "peppol" }]);
    });
  });
});
