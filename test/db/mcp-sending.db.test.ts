import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import type { Pool } from "pg";
import { loadMcpTools } from "../utils/mcp";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// Sending through the MCP server, as an assistant does.

const PEPPOL_RECIPIENT = "0208:0428643097";
const SEND_TOOLS = ["describe_document", "prepare_send"];
const BIS3_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const BILLING_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

let pool: Pool;
let app: Hono;
let sender: string;
let reader: string;

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
const rpc = async (method: string, params: Record<string, unknown> = {}, as = sender) => {
  const response = await app.request("/mcp", {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: as,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
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
});
