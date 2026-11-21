import { afterAll, beforeAll, describe, expect, it, mock, setSystemTime } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import type { Pool } from "pg";
import { loadMcpTools } from "../utils/mcp";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// Sending through the MCP server as an assistant does: prepare a document, show the user what it
// is, then send exactly that. The validation service, the recipient's registrations, the access
// point and the mail service stand in for the real ones.

const PEPPOL_RECIPIENT = "0208:0428643097";
const SEND_TOOLS = ["describe_document", "prepare_send", "send_document"];
const BIS3_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const BILLING_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const CDAR =
  "urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100::CrossDomainAcknowledgementAndResponse##urn:peppol:france:billing:cdv:1.0::D22B";
const FRENCH_REGULATED_PROCESS = "urn:peppol:france:billing:regulated";

let pool: Pool;
let app: Hono;
let sender: string;
let reader: string;
let mailed: number;
let mailAnswer: () => Promise<{ messageId: string }>;
// The document types the Peppol recipient receives, and what the access point was handed
let received: string[] = [BIS3_INVOICE];
let transmitted: string[] = [];
let transmit: () => Promise<{ ok: boolean; sendingException?: { category?: string; message: string } }>;

const invoice = (invoiceNumber = "INV-1") => ({
  document: {
    buyer: { city: "Gent", country: "BE", name: "Buyer BV", postalZone: "9000", street: "Kouter 1", vatNumber: null },
    invoiceNumber,
    issueDate: "2026-11-16",
    lines: [{ name: "Consulting", netPriceAmount: "100.00", quantity: "1", unitCode: "HUR", vat: { category: "S", percentage: "21.00" } }],
    paymentMeans: [{ iban: "BE68539007547034", paymentMethod: "credit_transfer", reference: invoiceNumber }],
  },
  documentType: "invoice",
  email: { to: ["accounts@buyer.example"], when: "always" },
  recipient: null,
});

/** The same invoice for a buyer on Peppol, in a named format so the recipient isn't looked up. */
const peppolInvoice = () => ({
  ...invoice(),
  doctypeId: BIS3_INVOICE,
  email: undefined,
  processId: BILLING_PROCESS,
  recipient: PEPPOL_RECIPIENT,
});

/** The JSON-RPC response to a request, by default made with the key that may send. */
const rpc = async (method: string, params: Record<string, unknown> = {}, as = sender, headers: Record<string, string> = {}) => {
  const response = await app.request("/mcp", {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: as,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      ...headers,
    },
    method: "POST",
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  // A response streamed as server-sent events carries its message on a `data:` line
  const body = text.startsWith("{") ? text : text.split("\n").find((line) => line.startsWith("data: "))!.slice(6);

  return JSON.parse(body);
};

const callTool = async (name: string, args: Record<string, unknown>, as = sender) =>
  (await rpc("tools/call", { arguments: args, name }, as)).result as { isError?: boolean; structuredContent: Record<string, any> };

/** How many send requests the metrics counted with an outcome, as the API's are counted. */
const countedSends = async (outcome: string, status: string) => {
  const { registry } = await import("../../utils/metrics");
  const series = `peppol_send_document_requests_total{network="production",outcome="${outcome}",status="${status}"} `;

  return Number(registry.render().split("\n").find((line) => line.startsWith(series))?.slice(series.length) ?? 0);
};

const count = async (table: string) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

/** An API key in the team, holding the permissions given, as its owner does. */
const seedKey = async (id: string, permissionIds: string[]) => {
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'unused')`, [`usr_${id}`, `${id}@example.com`]);
  await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, [TEAM_ID, `usr_${id}`]);
  await pool.query(`INSERT INTO api_keys (id, name, team_id, user_id, secret_hash) VALUES ($1, 'Key', $2, $3, $4)`, [
    id,
    TEAM_ID,
    `usr_${id}`,
    await Bun.password.hash("secret", { algorithm: "bcrypt", cost: 4 }),
  ]);
  for (const permissionId of permissionIds) {
    await pool.query(`INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES ($1, $2, $3)`, [`usr_${id}`, TEAM_ID, permissionId]);
    await pool.query(
      `INSERT INTO principal_permissions (principal_type, principal_id, team_id, permission_id) VALUES ('api_key', $1, $2, $3)`,
      [id, TEAM_ID, permissionId]
    );
  }

  return `Basic ${Buffer.from(`${id}:secret`).toString("base64")}`;
};

describe.skipIf(!testDatabaseUrl)("sending through the MCP server against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    // The validation service is a service of its own; what it does isn't what's tested here
    mock.module("../../utils/pipelines/sending/validate-document", () => ({
      validateDocument: async () => ({ errors: [], result: "valid" }),
    }));
    const email = await import("../../data/email/send-email");
    mock.module("@peppol/data/email/send-email", () => ({
      ...email,
      sendDocumentEmail: () => {
        mailed += 1;

        return mailAnswer();
      },
    }));
    const capabilities = await import("../../data/recipient-capabilities");
    const lookUpRecipient = capabilities.getRecipientCapabilities;
    mock.module("@peppol/data/recipient-capabilities", () => ({
      ...capabilities,
      // A playground answers from its own companies' registrations, as it does outside tests
      getRecipientCapabilities: async (options: Parameters<typeof lookUpRecipient>[0]) =>
        options.isPlayground
          ? lookUpRecipient(options)
          : {
              getProcessIds: async () => [BILLING_PROCESS],
              supportsDocType: (docTypeId: string) => received.includes(docTypeId),
            },
    }));
    const recipient = await import("../../data/recipient");
    mock.module("@peppol/data/recipient", () => ({ ...recipient, isParticipantUnregistered: async () => false }));
    const accessPoints = await import("../../data/access-point-providers");
    mock.module("@peppol/data/access-point-providers", () => ({
      ...accessPoints,
      getAccessPointProvider: () => ({
        sendAs4: async ({ docTypeId }: { docTypeId: string }) => {
          transmitted.push(docTypeId);

          return {
            apTransactionId: `tx_${transmitted.length}_${docTypeId.length}_${Date.now()}`,
            peppolConversationId: null,
            peppolMessageId: null,
            receivedPeppolSignalMessage: null,
            sbdhInstanceIdentifier: null,
            ...(await transmit()),
          };
        },
      }),
    }));
    process.env.JWT_SECRET ??= "mcp-sending-test-secret";
    process.env.BASE_URL ??= "https://recommand.example.com";

    await seedTeamAndCompany(pool);
    await pool.query(
      `UPDATE peppol_companies SET country = 'BE', enterprise_number_scheme = '0208', enterprise_number = '0123456749', vat_number = 'BE0123456749',
         is_verified = true, access_point_provider = 'recommand-ap1', smp_provider = 'recommand-smp1' WHERE id = $1`,
      [COMPANY_ID]
    );
    await pool.query(`INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_mcp', $1, '0208', '0123456749')`, [
      COMPANY_ID,
    ]);
    sender = await seedKey("key_sender", ["exchange.documents.send"]);
    reader = await seedKey("key_reader", ["exchange.documents.read"]);

    (await import("../../lib/event-types")).registerPeppolEventTypes();
    await import("../../lib/permissions");
    await loadMcpTools();
    const { default: mcp } = await import("@core/api/mcp");
    app = new Hono();
    app.route("/", mcp as never);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("offers the send tools only to a credential that may send", async () => {
    const names = async (as: string) => (await rpc("tools/list", {}, as)).result.tools.map((tool: { name: string }) => tool.name);

    expect(await names(sender)).toEqual(expect.arrayContaining(SEND_TOOLS));
    expect((await names(reader)).filter((name: string) => SEND_TOOLS.includes(name))).toEqual([]);
  });

  it("describes a document type's fields, and raw XML as a string", async () => {
    const { isError, structuredContent } = await callTool("describe_document", { documentType: "invoice" });

    expect(isError).toBeFalsy();
    expect(structuredContent.documentType).toBe("invoice");
    expect(structuredContent.schema.properties).toHaveProperty("invoiceNumber");
    expect(structuredContent.schema.properties).toHaveProperty("lines");
    expect(structuredContent.schema.$defs).toBeObject();
    expect((await callTool("describe_document", { documentType: "xml" })).structuredContent.schema).toMatchObject({ type: "string" });
  });

  it("prepares a document without sending it, and sums it up for the user", async () => {
    const { isError, structuredContent } = await callTool("prepare_send", { companyId: COMPANY_ID, ...peppolInvoice() });

    expect(isError).toBeFalsy();
    expect(structuredContent).toMatchObject({
      document: { documentNumber: "INV-1", type: "invoice" },
      email: null,
      peppolRoutingFailure: null,
      recipient: PEPPOL_RECIPIENT,
      validation: "valid",
    });
    expect(structuredContent.handle).toStartWith("prs_");
    expect(new Date(structuredContent.expiresAt).getTime() - Date.now()).toBeWithin(14 * 60 * 1_000, 15 * 60 * 1_000 + 1);
    expect(await count("peppol_transmitted_documents")).toBe(0);
  });

  it("says what's wrong with a document that can't be sent", async () => {
    const { isError, structuredContent } = await callTool("prepare_send", {
      companyId: COMPANY_ID,
      ...invoice(),
      email: undefined,
    });

    expect(isError).toBe(true);
    expect(structuredContent).toEqual({
      code: "invalid_input",
      message: "Either recipient (for Peppol) or email.to (for email delivery) must be provided.",
    });
  });

  it("names the field of a document that doesn't match its type", async () => {
    const { document } = invoice();
    const { isError, structuredContent } = await callTool("prepare_send", {
      companyId: COMPANY_ID,
      ...invoice(),
      document: { ...document, invoiceNumber: undefined },
    });

    expect(isError).toBe(true);
    expect(structuredContent.code).toBe("invalid_input");
    expect(structuredContent.message).toContain("document.invoiceNumber");
  });

  it("says what a document needs that its format can't do without", async () => {
    const { document } = invoice();
    const { isError, structuredContent } = await callTool("prepare_send", {
      companyId: COMPANY_ID,
      ...invoice(),
      document: { ...document, lines: [{ ...document.lines[0], vat: { category: "E", percentage: "0.00" } }] },
    });

    expect(isError).toBe(true);
    expect(structuredContent).toEqual({ code: "invalid_input", message: "Exemption reason code or reason is required for tax category E" });
  });

  it("doesn't prepare for a company of another team", async () => {
    await pool.query(`INSERT INTO teams (id, name) VALUES ('team_other', 'Other')`);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, access_point_provider, smp_provider)
       VALUES ('c_other', 'team_other', 'Other BV', 'Kouter 2', '9000', 'Gent', 'BE', 'recommand-ap1', 'recommand-smp1')`
    );

    expect((await callTool("prepare_send", { companyId: "c_other", ...invoice() })).structuredContent.code).toBe("not_found");
  });

  it("doesn't prepare for a team that can't exchange documents, or for a company it must verify first", async () => {
    const prepared = await count("peppol_prepared_sends");
    const entitlements = await import("@peppol/lib/entitlements");
    entitlements.registerEntitlementResolver(async () => ({ allowed: false, message: "Upgrade to send documents." }));
    try {
      expect((await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice() })).structuredContent).toEqual({
        code: "not_allowed",
        message: "Upgrade to send documents.",
      });
    } finally {
      entitlements.clearEntitlementResolver();
    }

    await pool.query(`UPDATE peppol_team_extensions SET verification_requirements = 'strict' WHERE id = $1`, [TEAM_ID]);
    await pool.query(`UPDATE peppol_companies SET is_verified = false WHERE id = $1`, [COMPANY_ID]);
    try {
      expect((await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice() })).structuredContent.code).toBe("not_allowed");
    } finally {
      await pool.query(`UPDATE peppol_team_extensions SET verification_requirements = DEFAULT WHERE id = $1`, [TEAM_ID]);
      await pool.query(`UPDATE peppol_companies SET is_verified = true WHERE id = $1`, [COMPANY_ID]);
    }

    expect(await count("peppol_prepared_sends")).toBe(prepared);
  });

  it("sends a prepared document once and stores it once, and hands a repeat the first send's answer", async () => {
    mailed = 0;
    mailAnswer = async () => ({ messageId: "msg-1" });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-SEND") })).structuredContent;
    const stored = await count("peppol_transmitted_documents");
    const [sent, replayed] = [await countedSends("success", "200"), await countedSends("replayed", "200")];

    const first = await callTool("send_document", { handle });
    const repeat = await callTool("send_document", { handle });

    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({ companyId: COMPANY_ID, emailRecipients: ["accounts@buyer.example"], sentOverEmail: true });
    expect(repeat.structuredContent.id).toBe(first.structuredContent.id);
    expect(await countedSends("success", "200")).toBe(sent + 1);
    expect(await countedSends("replayed", "200")).toBe(replayed + 1);

    // Once the handle expired, a repeat still gets the first send's answer, since that send has an outcome
    await pool.query(`UPDATE peppol_prepared_sends SET expires_at = now() - interval '1 minute' WHERE id = $1`, [handle]);
    expect((await callTool("send_document", { handle })).structuredContent.id).toBe(first.structuredContent.id);
    expect(mailed).toBe(1);
    expect(await count("peppol_transmitted_documents")).toBe(stored + 1);
  });

  it("sends a document as it was checked, on the day it was prepared and from the company as it was", async () => {
    mailed = 0;
    mailAnswer = async () => ({ messageId: "msg-dated" });
    const { document, ...request } = invoice("INV-DATED");
    const { issueDate: _, ...undated } = document;
    try {
      setSystemTime(new Date(2026, 10, 16, 23, 55));
      const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...request, document: undated })).structuredContent;
      await pool.query(`UPDATE peppol_companies SET name = 'Renamed BV' WHERE id = $1`, [COMPANY_ID]);
      setSystemTime(new Date(2026, 10, 17, 0, 5));

      const { structuredContent } = await callTool("send_document", { handle });
      const [sent] = (
        await pool.query(
          `SELECT parsed->>'issueDate' AS "issueDate", parsed->>'dueDate' AS "dueDate", parsed->'seller'->>'name' AS seller
             FROM peppol_transmitted_documents WHERE id = $1`,
          [structuredContent.id]
        )
      ).rows;

      expect(sent).toEqual({ dueDate: "2026-12-16", issueDate: "2026-11-16", seller: "Example SARL" });
    } finally {
      setSystemTime();
      await pool.query(`UPDATE peppol_companies SET name = 'Example SARL' WHERE id = $1`, [COMPANY_ID]);
    }
  });

  it("sends a self-billing invoice with the buyer the company was when it was prepared", async () => {
    mailed = 0;
    mailAnswer = async () => ({ messageId: "msg-self-billing" });
    const {
      document: { buyer, ...document },
      ...request
    } = invoice("SB-1");
    const { handle } = (
      await callTool("prepare_send", { companyId: COMPANY_ID, ...request, document: { ...document, seller: buyer }, documentType: "selfBillingInvoice" })
    ).structuredContent;
    await pool.query(`UPDATE peppol_companies SET name = 'Renamed BV' WHERE id = $1`, [COMPANY_ID]);
    try {
      const { structuredContent } = await callTool("send_document", { handle });
      const [sent] = (await pool.query(`SELECT parsed->'buyer'->>'name' AS buyer FROM peppol_transmitted_documents WHERE id = $1`, [structuredContent.id]))
        .rows;

      expect(sent).toEqual({ buyer: "Example SARL" });
    } finally {
      await pool.query(`UPDATE peppol_companies SET name = 'Example SARL' WHERE id = $1`, [COMPANY_ID]);
    }
  });

  it("sends over Peppol in the format a document was checked in, without routing it again", async () => {
    received = [BIS3_INVOICE];
    transmitted = [];
    transmit = async () => ({ ok: true });
    const { handle, recipient } = (
      await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-ROUTED"), email: undefined, recipient: PEPPOL_RECIPIENT })
    ).structuredContent;
    // The recipient stops receiving the format before the user approved the summary
    received = [];

    const { structuredContent } = await callTool("send_document", { handle });

    expect(recipient).toBe(PEPPOL_RECIPIENT);
    expect(structuredContent.sentOverPeppol).toBe(true);
    expect(transmitted).toEqual([BIS3_INVOICE]);
  });

  it("tells a model to prepare again when the recipient no longer receives the format it was prepared in", async () => {
    // A playground checks the recipient's registrations when it sends, as an access point does
    await pool.query(`UPDATE peppol_team_extensions SET is_playground = true WHERE id = $1`, [TEAM_ID]);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number, is_smp_recipient, access_point_provider, smp_provider)
       VALUES ('c_playground_buyer', $1, 'Buyer BV', 'Kouter 1', '9000', 'Gent', 'BE', '0846443741', true, 'recommand-ap1', 'recommand-smp1')`,
      [TEAM_ID]
    );
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_playground_buyer', 'c_playground_buyer', '0208', '0846443741')`
    );
    await pool.query(
      `INSERT INTO peppol_company_document_types (id, company_id, doc_type_id, process_id) VALUES ('cdt_playground_buyer', 'c_playground_buyer', $1, $2)`,
      [BIS3_INVOICE, BILLING_PROCESS]
    );
    try {
      const { handle } = (
        await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-DROPPED"), email: undefined, recipient: "0208:0846443741" })
      ).structuredContent;
      // The buyer stops receiving invoices in that format before the user approved the summary
      await pool.query(`DELETE FROM peppol_company_document_types WHERE id = 'cdt_playground_buyer'`);

      const { structuredContent } = await callTool("send_document", { handle });

      expect(structuredContent.code).toBe("delivery_failed");
      expect(structuredContent.message).toContain("Prepare it again.");
    } finally {
      await pool.query(`DELETE FROM peppol_companies WHERE id = 'c_playground_buyer'`);
      await pool.query(`UPDATE peppol_team_extensions SET is_playground = false WHERE id = $1`, [TEAM_ID]);
    }
  });

  it("has a model report a send refused for what changed since the document was prepared", async () => {
    mailed = 0;
    mailAnswer = async () => ({ messageId: "msg-refused" });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-NO-SENDER") })).structuredContent;
    // The company no longer has an identifier to send from
    await pool.query(`DELETE FROM peppol_company_identifiers WHERE id = 'ci_mcp'`);
    try {
      const { structuredContent } = await callTool("send_document", { handle });

      expect(structuredContent.code).toBe("send_refused");
      expect(structuredContent.message).toStartWith("No sending company identifier found.");
      expect(structuredContent.message).toContain("Tell the user");
    } finally {
      await pool.query(`INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_mcp', $1, '0208', '0123456749')`, [
        COMPANY_ID,
      ]);
    }

    expect(mailed).toBe(0);
  });

  it("sends a French status report with the ID and dates it was prepared with", async () => {
    transmitted = [];
    transmit = async () => ({ ok: true });
    // Through the French access point, with the company's SIREN
    await pool.query(`UPDATE peppol_companies SET country = 'FR', access_point_provider = 'at-shared-ap-fr', smp_provider = 'at-shared-smp-fr' WHERE id = $1`, [
      COMPANY_ID,
    ]);
    await pool.query(`INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_mcp_fr', $1, '0225', '732829320')`, [
      COMPANY_ID,
    ]);
    try {
      setSystemTime(new Date(2026, 10, 16, 23, 55));
      const { handle } = (
        await callTool("prepare_send", {
          companyId: COMPANY_ID,
          doctypeId: CDAR,
          document: {
            businessProcess: "REGULATED",
            invoiceId: "INV-2026-001",
            invoiceIssueDate: "2026-07-23",
            invoiceTypeCode: "380",
            issuerLegalId: "123456789",
            issuerLegalIdScheme: "0002",
            issuerRole: "BY",
            recipientRole: "SE",
            sellerLegalId: "123456789",
            sellerLegalIdScheme: "0002",
            senderRole: "WK",
            statusCode: "205",
          },
          documentType: "frenchInvoicingCdar",
          processId: FRENCH_REGULATED_PROCESS,
          recipient: "0225:987654321_STATUTS",
        })
      ).structuredContent;
      const [prepared] = (await pool.query(`SELECT input->'document' AS document FROM peppol_prepared_sends WHERE id = $1`, [handle])).rows;
      setSystemTime(new Date(2026, 10, 17, 0, 5));

      const { structuredContent } = await callTool("send_document", { handle });
      const [sent] = (
        await pool.query(
          `SELECT parsed->>'id' AS id, parsed->>'issueDate' AS "issueDate", parsed->>'statusDate' AS "statusDate" FROM peppol_transmitted_documents WHERE id = $1`,
          [structuredContent.id]
        )
      ).rows;

      expect(prepared.document.issueDate).toStartWith("2026-11-16T23:55");
      expect(sent).toEqual({ id: prepared.document.id, issueDate: prepared.document.issueDate, statusDate: prepared.document.issueDate });
    } finally {
      setSystemTime();
      await pool.query(`DELETE FROM peppol_company_identifiers WHERE id = 'ci_mcp_fr'`);
      await pool.query(`UPDATE peppol_companies SET country = 'BE', access_point_provider = 'recommand-ap1', smp_provider = 'recommand-smp1' WHERE id = $1`, [
        COMPANY_ID,
      ]);
    }
  });

  it("holds back a handle whose send may have gone out", async () => {
    mailed = 0;
    mailAnswer = async () => {
      throw new Error("Mail service unavailable");
    };
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-UNKNOWN") })).structuredContent;

    // Told so from the first answer on, so the document isn't corrected and prepared again, and a repeat gets
    // the same answer
    const first = await callTool("send_document", { handle });
    expect(first.structuredContent.code).toBe("delivery_failed");
    expect(first.structuredContent.message).toContain("unknown whether the document went out");
    expect((await callTool("send_document", { handle })).structuredContent).toEqual(first.structuredContent);
    // Also once the handle expired, when the answer is read from its key
    await pool.query(`UPDATE peppol_prepared_sends SET expires_at = now() - interval '1 minute' WHERE id = $1`, [handle]);
    expect((await callTool("send_document", { handle })).structuredContent).toEqual(first.structuredContent);
    expect(mailed).toBe(1);
  });

  it("holds back a handle whose send ended without an answer", async () => {
    mailed = 0;
    mailAnswer = async () => ({ messageId: "msg-unanswered" });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-UNANSWERED") })).structuredContent;
    await callTool("send_document", { handle });
    // As the key is left when the server stops before it stores the send's answer
    await pool.query(`UPDATE idempotency_keys SET response_body = null, response_status = null, status = 'outcome_unknown' WHERE key = $1`, [handle]);

    expect((await callTool("send_document", { handle })).structuredContent.code).toBe("idempotency_outcome_unknown");
    expect(mailed).toBe(1);
  });

  it("doesn't try again with an expired handle whose first send was refused before anything went out", async () => {
    mailed = 0;
    mailAnswer = async () => ({ messageId: "msg-3" });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-REFUSED") })).structuredContent;
    // A team that must verify its companies refuses the send of an unverified one before any channel
    await pool.query(`UPDATE peppol_team_extensions SET verification_requirements = 'strict' WHERE id = $1`, [TEAM_ID]);
    await pool.query(`UPDATE peppol_companies SET is_verified = false WHERE id = $1`, [COMPANY_ID]);
    try {
      expect((await callTool("send_document", { handle })).structuredContent.code).toBe("not_allowed");
    } finally {
      await pool.query(`UPDATE peppol_team_extensions SET verification_requirements = DEFAULT WHERE id = $1`, [TEAM_ID]);
      await pool.query(`UPDATE peppol_companies SET is_verified = true WHERE id = $1`, [COMPANY_ID]);
    }

    await pool.query(`UPDATE peppol_prepared_sends SET expires_at = now() - interval '1 minute' WHERE id = $1`, [handle]);

    expect((await callTool("send_document", { handle })).structuredContent.code).toBe("expired");
    expect(mailed).toBe(0);
  });

  it("acts, and is audited, as the call's credential, with its user agent and address", async () => {
    transmitted = [];
    transmit = async () => ({ ok: true });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...peppolInvoice(), document: invoice("INV-AUDIT").document }))
      .structuredContent;
    await rpc("tools/call", { arguments: { handle }, name: "send_document" }, sender, {
      "User-Agent": "mcp-audit-check",
      "X-Forwarded-For": "203.0.113.7",
    });

    const { rows } = await pool.query(
      `SELECT actor_api_key_id, actor_ip, actor_user_agent, team_id FROM audit_events
       WHERE action = 'create' AND subsystem = 'peppol.documents' AND actor_user_agent = 'mcp-audit-check'`
    );
    expect(rows).toEqual([{ actor_api_key_id: "key_sender", actor_ip: "203.0.113.7", actor_user_agent: "mcp-audit-check", team_id: TEAM_ID }]);
  });

  it("sends a handle once when two calls send it at the same time", async () => {
    transmitted = [];
    let answer: (result: { ok: boolean }) => void = () => {};
    transmit = () => new Promise((resolve) => (answer = resolve));
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...peppolInvoice(), document: invoice("INV-TWICE").document }))
      .structuredContent;
    const first = callTool("send_document", { handle });
    while (transmitted.length === 0) {
      await Bun.sleep(5);
    }

    expect((await callTool("send_document", { handle })).structuredContent.code).toBe("idempotency_in_progress");
    answer({ ok: true });
    expect((await first).isError).toBeFalsy();
    expect(transmitted).toEqual([BIS3_INVOICE]);
  });

  it("never sends with an expired handle, also when its key is freed while the repeat is on its way", async () => {
    transmitted = [];
    let answer: (result: { ok: boolean; sendingException?: { message: string } }) => void = () => {};
    transmit = () => new Promise((resolve) => (answer = resolve));
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...peppolInvoice(), document: invoice("INV-RACE").document }))
      .structuredContent;
    const first = callTool("send_document", { handle });
    while (transmitted.length === 0) {
      await Bun.sleep(5);
    }

    // The handle expires while the access point still has the document, and would take a second one
    await pool.query(`UPDATE peppol_prepared_sends SET expires_at = now() - interval '1 second' WHERE id = $1`, [handle]);
    const refuseFirst = () => answer({ ok: false, sendingException: { message: "Too many requests" } });
    transmit = async () => ({ ok: true });
    const entitlements = await import("@peppol/lib/entitlements");
    // Were the repeat to run the send despite the expired handle, it would check the entitlement next, right
    // when the access point refuses the first send and frees its key: it must still not send
    entitlements.registerEntitlementResolver(async () => {
      refuseFirst();
      await first;

      return { allowed: true };
    });
    try {
      expect((await callTool("send_document", { handle })).structuredContent.code).toBe("idempotency_in_progress");
    } finally {
      entitlements.clearEntitlementResolver();
    }

    refuseFirst();
    expect((await first).structuredContent.code).toBe("delivery_failed");
    expect((await callTool("send_document", { handle })).structuredContent.code).toBe("expired");
    expect(transmitted).toEqual([BIS3_INVOICE]);
  });

  it("never sends with an expired handle, also when its send's outcome stops being kept on the way", async () => {
    transmitted = [];
    transmit = async () => ({ ok: true });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...peppolInvoice(), document: invoice("INV-BOUNDARY").document }))
      .structuredContent;
    const { id } = (await callTool("send_document", { handle })).structuredContent;
    await pool.query(`UPDATE peppol_prepared_sends SET expires_at = now() - interval '1 minute' WHERE id = $1`, [handle]);
    const entitlements = await import("@peppol/lib/entitlements");
    // Were the repeat to get past the handle's expiry, the key's day would be up right then: it must still not send
    entitlements.registerEntitlementResolver(async () => {
      await pool.query(`UPDATE idempotency_keys SET expires_at = now() - interval '1 second' WHERE key = $1`, [handle]);

      return { allowed: true };
    });
    try {
      expect((await callTool("send_document", { handle })).structuredContent.id).toBe(id);
    } finally {
      entitlements.clearEntitlementResolver();
    }

    expect(transmitted).toEqual([BIS3_INVOICE]);
  });

  it("answers an expired handle from its send, without running the send", async () => {
    mailed = 0;
    mailAnswer = async () => ({ messageId: "msg-answered" });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-ANSWERED") })).structuredContent;
    const { id } = (await callTool("send_document", { handle })).structuredContent;
    await pool.query(`UPDATE peppol_prepared_sends SET expires_at = now() - interval '1 minute' WHERE id = $1`, [handle]);
    const entitlements = await import("@peppol/lib/entitlements");
    entitlements.registerEntitlementResolver(async () => ({ allowed: false, message: "Upgrade to send documents." }));
    try {
      expect((await callTool("send_document", { handle })).structuredContent.id).toBe(id);
    } finally {
      entitlements.clearEntitlementResolver();
    }

    expect(mailed).toBe(1);
  });

  it("hands a repeat refused before it got to the handle's key what the first send came to", async () => {
    mailed = 0;
    mailAnswer = async () => ({ messageId: "msg-granted" });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-GRANTED") })).structuredContent;
    const { id } = (await callTool("send_document", { handle })).structuredContent;
    const entitlements = await import("@peppol/lib/entitlements");
    entitlements.registerEntitlementResolver(async () => ({ allowed: false, message: "Upgrade to send documents." }));
    try {
      expect((await callTool("send_document", { handle })).structuredContent.id).toBe(id);
    } finally {
      entitlements.clearEntitlementResolver();
    }

    expect(mailed).toBe(1);
  });

  it("tells a repeat refused while the first send is still running to wait for it", async () => {
    transmitted = [];
    let answer: (result: { ok: boolean }) => void = () => {};
    transmit = () => new Promise((resolve) => (answer = resolve));
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...peppolInvoice(), document: invoice("INV-WAIT").document }))
      .structuredContent;
    const first = callTool("send_document", { handle });
    while (transmitted.length === 0) {
      await Bun.sleep(5);
    }

    const entitlements = await import("@peppol/lib/entitlements");
    entitlements.registerEntitlementResolver(async () => ({ allowed: false, message: "Upgrade to send documents." }));
    try {
      expect((await callTool("send_document", { handle })).structuredContent.code).toBe("idempotency_in_progress");
    } finally {
      entitlements.clearEntitlementResolver();
    }

    answer({ ok: true });
    expect((await first).structuredContent.sentOverPeppol).toBe(true);
    expect(transmitted).toEqual([BIS3_INVOICE]);
  });

  it("never sends with an expired handle once its send's outcome is no longer kept", async () => {
    transmitted = [];
    transmit = async () => ({ ok: true });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...peppolInvoice(), document: invoice("INV-KEPT").document }))
      .structuredContent;
    expect((await callTool("send_document", { handle })).structuredContent.sentOverPeppol).toBe(true);

    await pool.query(`UPDATE peppol_prepared_sends SET expires_at = now() - interval '1 minute' WHERE id = $1`, [handle]);
    await pool.query(`UPDATE idempotency_keys SET expires_at = now() - interval '1 second' WHERE key = $1`, [handle]);

    expect((await callTool("send_document", { handle })).structuredContent.code).toBe("expired");
    expect(transmitted).toEqual([BIS3_INVOICE]);
  });

  it("answers for a handle as long as its send's outcome is kept, however long ago it expired", async () => {
    mailed = 0;
    mailAnswer = async () => ({ messageId: "msg-late" });
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-LATE") })).structuredContent;
    const { id } = (await callTool("send_document", { handle })).structuredContent;
    // Expired more than a day ago, while the send that finished late still has its outcome kept
    await pool.query(`UPDATE peppol_prepared_sends SET expires_at = now() - interval '2 days' WHERE id = $1`, [handle]);
    await pool.query(`UPDATE idempotency_keys SET expires_at = now() + interval '1 hour' WHERE key = $1`, [handle]);

    // The hourly purge deletes the prepared documents nobody can ask about anymore
    const { purgeExpiredPreparedSends } = await import("../../data/prepared-sends");
    await purgeExpiredPreparedSends();
    expect((await callTool("send_document", { handle })).structuredContent.id).toBe(id);

    await pool.query(`UPDATE idempotency_keys SET expires_at = now() - interval '1 second' WHERE key = $1`, [handle]);
    await purgeExpiredPreparedSends();
    expect((await callTool("send_document", { handle })).structuredContent.code).toBe("not_found");
    expect(mailed).toBe(1);
  });

  it("refuses an expired handle that never sent, and another team's", async () => {
    mailed = 0;
    const { handle } = (await callTool("prepare_send", { companyId: COMPANY_ID, ...invoice("INV-EXPIRED") })).structuredContent;
    await pool.query(`UPDATE peppol_prepared_sends SET expires_at = now() - interval '1 minute' WHERE id = $1`, [handle]);
    await pool.query(`INSERT INTO teams (id, name) VALUES ('team_elsewhere', 'Elsewhere')`);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, access_point_provider, smp_provider)
       VALUES ('c_elsewhere', 'team_elsewhere', 'Elsewhere BV', 'Kouter 3', '9000', 'Gent', 'BE', 'recommand-ap1', 'recommand-smp1')`
    );
    await pool.query(
      `INSERT INTO peppol_prepared_sends (id, expires_at, input, company_id, team_id) VALUES ('prs_elsewhere', now() + interval '1 minute', $1, 'c_elsewhere', 'team_elsewhere')`,
      [JSON.stringify(invoice("INV-ELSEWHERE"))]
    );

    expect((await callTool("send_document", { handle })).structuredContent.code).toBe("expired");
    expect((await callTool("send_document", { handle: "prs_elsewhere" })).structuredContent.code).toBe("not_found");
    expect(mailed).toBe(0);
  });
});
