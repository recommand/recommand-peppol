import { afterAll, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { exportJWK, generateKeyPair } from "jose";
import type { Pool } from "pg";
import { loadMcpTools } from "../utils/mcp";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedDocument, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// The Exchange tools as an MCP client reaches them: through Core's endpoint, with
// an OAuth grant, acting in the grant's team with the permissions it holds there.

const PEPPOL_INVOICE =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const PEPPOL_CREDIT_NOTE =
  "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";

let pool: Pool;
let app: Hono;
let authorization: string;
let companiesOnlyAuthorization: string;

/** The JSON-RPC response to a request made with a credential, by default the one holding every permission. */
const send = async (method: string, params: Record<string, unknown> = {}, as = authorization) => {
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

const rpc = async (method: string, params: Record<string, unknown> = {}) => (await send(method, params)).result;

const callTool = async (name: string, args: Record<string, unknown> = {}) =>
  (await rpc("tools/call", { arguments: args, name })) as { isError?: boolean; structuredContent: Record<string, any> };

describe.skipIf(!testDatabaseUrl)("the Exchange MCP tools against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    process.env.JWT_SECRET ??= "mcp-tools-test-secret";
    process.env.BASE_URL ??= "https://recommand.example.com";
    process.env.SIGNING_KEYS = JSON.stringify({
      keys: [await exportJWK((await generateKeyPair("RS256", { extractable: true })).privateKey)],
    });

    await seedTeamAndCompany(pool);
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ('usr_member', 'member@example.com', 'unused')`);
    await pool.query(`INSERT INTO team_members (team_id, user_id) VALUES ($1, 'usr_member')`, [TEAM_ID]);
    await pool.query(
      `INSERT INTO user_permissions (user_id, team_id, permission_id) VALUES
        ('usr_member', $1, 'exchange.companies.read'), ('usr_member', $1, 'exchange.documents.read'),
        ('usr_member', $1, 'exchange.identifiers.read')`,
      [TEAM_ID]
    );
    await pool.query(`INSERT INTO oauth_clients (id, kind, grant_types, redirect_uris, token_endpoint_auth_method) VALUES
      ('dcr_app', 'dynamic', '{authorization_code}', '{https://app.example.com/callback}', 'none')`);

    await import("../../lib/permissions");
    await loadMcpTools();
    const { findClient } = await import("@core/data/oauth-clients");
    const { createGrant } = await import("@core/data/oauth-grants");
    const { issueTokens } = await import("@core/data/oauth-tokens");
    const client = (await findClient("dcr_app"))!;
    const authorize = async (permissionIds: string[]) => {
      const { grant } = await createGrant({ client, permissionIds, teamIds: [TEAM_ID], userId: "usr_member" });
      const { accessToken } = (await issueTokens({
        grantId: grant.id,
        resources: ["https://recommand.example.com/mcp"],
        withRefreshToken: false,
      }))!;

      return `Bearer ${accessToken}`;
    };
    authorization = await authorize(["exchange.companies.read", "exchange.documents.read", "exchange.identifiers.read"]);
    companiesOnlyAuthorization = await authorize(["exchange.companies.read"]);

    const { default: mcp } = await import("@core/api/mcp");
    app = new Hono();
    app.route("/", mcp as never);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("lists the tools the grant's permissions allow", async () => {
    const { tools } = await rpc("tools/list");
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_teams",
      "list_companies",
      "search_documents",
      "get_document",
      "find_recipient",
    ]);
  });

  it("lists the team's companies", async () => {
    const { structuredContent } = await callTool("list_companies");
    expect(structuredContent.companies).toEqual([
      expect.objectContaining({ country: "FR", id: COMPANY_ID, name: "Example SARL", peppolIds: [] }),
    ]);
  });

  it("searches the team's documents, and says when one doesn't exist", async () => {
    expect((await callTool("search_documents", { unreadOnly: true })).structuredContent).toEqual({
      documents: [],
      pagination: { limit: 20, page: 1, total: 0, totalPages: 0 },
    });
    expect(await callTool("get_document", { documentId: "doc_missing" })).toMatchObject({
      isError: true,
      structuredContent: { code: "not_found" },
    });
  });

  it("pages through the companies, with their Peppol IDs", async () => {
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, access_point_provider, smp_provider)
       VALUES ('cmp_second', $1, 'Second BV', 'Kouter 1', '9000', 'Gent', 'BE', 'recommand-ap1', 'recommand-smp1')`,
      [TEAM_ID]
    );
    await pool.query(
      `INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ('ci_second', 'cmp_second', '0208', '0123456749')`
    );

    expect((await callTool("list_companies", { limit: 1, page: 2 })).structuredContent).toEqual({
      companies: [expect.objectContaining({ id: "cmp_second", peppolIds: ["0208:0123456749"] })],
      pagination: { limit: 1, page: 2, total: 2, totalPages: 2 },
    });
  });

  it("says a company is registered on Peppol only when it would be registered", async () => {
    const { structuredContent } = await callTool("list_companies");

    // A French company on the production network has to be verified first
    expect(structuredContent.companies).toEqual([
      expect.objectContaining({ id: COMPANY_ID, isRegisteredOnPeppol: false }),
      expect.objectContaining({ id: "cmp_second", isRegisteredOnPeppol: true }),
    ]);
  });

  it("gives a document's amount in its own currency", async () => {
    await seedDocument(pool, { id: "doc_usd" });
    await pool.query(`UPDATE peppol_transmitted_documents SET parsed = $1, search_text = 'INV-USD' WHERE id = 'doc_usd'`, [
      JSON.stringify({ currency: "USD", invoiceNumber: "INV-USD", totals: { payableAmount: "121.00" } }),
    ]);

    expect((await callTool("search_documents", { search: "INV-USD" })).structuredContent.documents).toEqual([
      expect.objectContaining({ amount: "121.00", currency: "USD", id: "doc_usd" }),
    ]);
  });

  it("keeps sent documents out of the inbox", async () => {
    await seedDocument(pool, { direction: "incoming", id: "doc_in" });
    await seedDocument(pool, { id: "doc_out" });

    expect((await callTool("search_documents", { unreadOnly: true })).structuredContent.documents).toEqual([
      expect.objectContaining({ direction: "incoming", id: "doc_in" }),
    ]);
    expect(await callTool("search_documents", { direction: "outgoing", unreadOnly: true })).toMatchObject({
      isError: true,
      structuredContent: { code: "invalid_input" },
    });
  });

  it("lists a document's attachments after they moved to storage, without their contents", async () => {
    await seedDocument(pool, { id: "doc_s3" });
    await pool.query(
      `UPDATE peppol_transmitted_documents SET attachments_location = 's3', parsed = $1, s3_key_prefix = 'documents/doc_s3' WHERE id = 'doc_s3'`,
      [JSON.stringify({ attachments: null, invoiceNumber: "INV-S3" })]
    );
    const s3 = await import("@core/lib/s3");
    const download = spyOn(s3, "downloadTextFile").mockResolvedValue(
      JSON.stringify([{ embeddedDocument: "JVBERi0=", filename: "terms.pdf", mimeCode: "application/pdf" }])
    );

    const { structuredContent } = await callTool("get_document", { documentId: "doc_s3" });
    download.mockRestore();

    expect(structuredContent.parsed.attachments).toEqual([
      expect.objectContaining({ filename: "terms.pdf", hasContents: true, mimeCode: "application/pdf" }),
    ]);
    expect(structuredContent.parsed.attachments[0]).not.toHaveProperty("embeddedDocument");
  });

  it("names the document types a directory match accepts, and how many companies match in all", async () => {
    const directory = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        matches: [
          {
            docTypes: [{ value: PEPPOL_INVOICE }, { value: PEPPOL_CREDIT_NOTE }],
            entities: [{ name: [{ name: "Buyer BV" }] }],
            participantID: { value: "0208:0123456749" },
          },
        ],
        "total-result-count": 57,
      })
    );

    const { structuredContent } = await callTool("find_recipient", { name: "Buyer" });
    directory.mockRestore();

    expect(structuredContent).toEqual({
      matches: [
        {
          name: "Buyer BV",
          peppolAddress: "0208:0123456749",
          supportedDocumentTypes: ["Peppol BIS Billing UBL Credit Note V3", "Peppol BIS Billing UBL Invoice V3"],
        },
      ],
      total: 57,
    });
  });

  it("checks a Peppol address without the SMP's addresses", async () => {
    const recipient = await import("@peppol/data/recipient");
    const verify = spyOn(recipient, "verifyRecipient").mockResolvedValue({
      serviceMetadataReferences: ["https://smp.example.com/iso6523-actorid-upis%3A%3A0208%3A0123456749/services/invoice"],
      smpHostnames: ["smp.example.com"],
      smpUrl: "https://smp.example.com",
      supportedDocuments: [
        { docTypeId: PEPPOL_INVOICE, name: "Peppol BIS Billing UBL Invoice V3" },
        { docTypeId: `${PEPPOL_INVOICE}::other-version`, name: "Peppol BIS Billing UBL Invoice V3" },
      ],
    });
    const businessCard = spyOn(recipient, "fetchBusinessCard").mockResolvedValue({ companyName: "Buyer BV", countryCode: "BE" });

    const { structuredContent } = await callTool("find_recipient", { peppolAddress: "0208:0123456749" });
    verify.mockRestore();
    businessCard.mockRestore();

    expect(structuredContent).toEqual({
      companyName: "Buyer BV",
      countryCode: "BE",
      isValid: true,
      supportedDocumentTypes: ["Peppol BIS Billing UBL Invoice V3"],
    });
  });

  it("doesn't reach another team's document", async () => {
    await pool.query(`INSERT INTO teams (id, name) VALUES ('team_other', 'Other team')`);
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, access_point_provider, smp_provider)
       VALUES ('cmp_other', 'team_other', 'Other BV', 'Kouter 2', '9000', 'Gent', 'BE', 'recommand-ap1', 'recommand-smp1')`
    );
    await seedDocument(pool, { id: "doc_other" });
    await pool.query(
      `UPDATE peppol_transmitted_documents SET company_id = 'cmp_other', search_text = 'INV-OTHER', team_id = 'team_other' WHERE id = 'doc_other'`
    );

    expect(await callTool("get_document", { documentId: "doc_other" })).toMatchObject({
      isError: true,
      structuredContent: { code: "not_found" },
    });
    expect((await callTool("search_documents", { search: "INV-OTHER" })).structuredContent.documents).toEqual([]);
  });

  it("refuses the documents of a team without document access", async () => {
    const entitlements = await import("@peppol/lib/entitlements");
    entitlements.registerEntitlementResolver(async () => ({ allowed: false, message: "Upgrade to read your documents." }));
    try {
      for (const [name, args] of [["get_document", { documentId: "doc_usd" }], ["search_documents", {}]] as const) {
        expect(await callTool(name, args)).toMatchObject({ isError: true, structuredContent: { code: "no_document_access" } });
      }
    } finally {
      entitlements.clearEntitlementResolver();
    }
  });

  it("lists companies only for a credential that may read their Peppol IDs too", async () => {
    const { result } = await send("tools/list", {}, companiesOnlyAuthorization);
    expect(result.tools.map((tool: { name: string }) => tool.name)).not.toContain("list_companies");
  });

  it("doesn't hand documents to a credential without the permission to read them", async () => {
    const { result } = await send("tools/list", {}, companiesOnlyAuthorization);
    expect(result.tools.map((tool: { name: string }) => tool.name)).not.toContain("get_document");

    const response = await send("tools/call", { arguments: { documentId: "doc_usd" }, name: "get_document" }, companiesOnlyAuthorization);
    expect(response.error ?? response.result?.isError).toBeTruthy();
    expect(response.result?.structuredContent?.id).toBeUndefined();
  });

  it("hands a long document's lines over a page at a time", async () => {
    await seedDocument(pool, { id: "doc_long" });
    await pool.query(`UPDATE peppol_transmitted_documents SET parsed = $1 WHERE id = 'doc_long'`, [
      JSON.stringify({ invoiceNumber: "INV-LONG", lines: [{ name: "Line 1" }, { name: "Line 2" }, { name: "Line 3" }] }),
    ]);

    const { structuredContent } = await callTool("get_document", { documentId: "doc_long", limit: 2, page: 2 });

    expect(structuredContent.linePagination).toEqual({ limit: 2, page: 2, total: 3, totalPages: 2 });
    expect(structuredContent.parsed.lines).toEqual([{ name: "Line 3" }]);
  });
});
