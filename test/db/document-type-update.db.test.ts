import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { connectTestDatabase, testDatabaseUrl } from "./harness";

// Changing a document type takes the previous one off the SMP before the company is
// published with the new one. A company holding a Norwegian organisation number is
// checked against Enhetsregisteret before it is published, and that check can refuse
// a company that was published long ago. Whatever happens after the change starts,
// the SMP has to end up publishing what the company's record says. The SMP and the
// register are a scripted fetch; the company, its identifiers and its document
// types are real rows.

let pool: Pool;
let updateCompanyDocumentType: typeof import("../../data/company-document-types").updateCompanyDocumentType;

const TEAM = "team_doctype";
const COMPANY = "c_doctype";
const INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const CREDIT_NOTE = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const BILLING = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

const requests: { url: string; method: string }[] = [];
// How Enhetsregisteret answers a lookup, and whether the SMP refuses to publish the credit note.
let registerStatus = 200;
let refuseCreditNote = false;

const fetchMock = spyOn(globalThis, "fetch");
fetchMock.mockImplementation(
  Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = decodeURIComponent(String(input));
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url.includes("data.brreg.no")) {
        return registerStatus === 200
          ? Response.json({ organisasjonsnummer: "974760673", navn: "NORDLYS HANDEL AS" })
          : new Response("{}", { status: registerStatus });
      }
      if (refuseCreditNote && method === "PUT" && url.includes(CREDIT_NOTE)) {
        return new Response("Refused", { status: 500 });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
    { preconnect: globalThis.fetch.preconnect },
  ),
);

/** The SMP requests that change a service metadata entry, as `METHOD document type`. */
function serviceMetadataChanges() {
  return requests
    .filter((request) => request.method !== "GET" && request.url.includes("/services/"))
    .map((request) => `${request.method} ${request.url.split("/services/busdox-docid-qns::")[1]}`);
}

async function documentTypeRow() {
  const { rows } = await pool.query(`SELECT doc_type_id FROM peppol_company_document_types WHERE id = 'cdt_doctype'`);
  return rows[0].doc_type_id as string;
}

describe.skipIf(!testDatabaseUrl)("changing a published document type", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({ sendSystemAlert: async () => {} }));
    process.env.AP_CERT = "test certificate";
    ({ updateCompanyDocumentType } = await import("../../data/company-document-types"));
    await pool.query(`INSERT INTO teams (id, name) VALUES ($1, $1)`, [TEAM]);
    await pool.query(
      `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network, verification_requirements) VALUES ($1, false, false, 'trusted')`,
      [TEAM]
    );
  });

  afterAll(async () => {
    fetchMock.mockRestore();
    await pool?.end();
  });

  beforeEach(async () => {
    requests.length = 0;
    registerStatus = 200;
    refuseCreditNote = false;
    await pool.query("TRUNCATE peppol_companies CASCADE");
    // A Belgian company that also holds a Norwegian organisation number, all on our own SMP.
    await pool.query(
      `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, enterprise_number_scheme, enterprise_number, vat_number,
         is_smp_recipient, is_verified, access_point_provider, smp_provider)
       VALUES ($1, $2, 'Example BV', 'Straat 1', '9000', 'Gent', 'BE', '0208', '0123456749', 'BE0123456749', true, true, 'recommand-ap1', 'recommand-smp1')`,
      [COMPANY, TEAM]
    );
    for (const [scheme, identifier] of [["0208", "0123456749"], ["0192", "974760673"]]) {
      await pool.query(`INSERT INTO peppol_company_identifiers (id, company_id, scheme, identifier) VALUES ($1, $2, $3, $4)`, [
        `${COMPANY}_${scheme}`,
        COMPANY,
        scheme,
        identifier,
      ]);
    }
    await pool.query(
      `INSERT INTO peppol_company_document_types (id, company_id, doc_type_id, process_id) VALUES ('cdt_doctype', $1, $2, $3)`,
      [COMPANY, INVOICE, BILLING]
    );
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  const changeToCreditNote = () =>
    updateCompanyDocumentType({
      companyDocumentType: { id: "cdt_doctype", companyId: COMPANY, docTypeId: CREDIT_NOTE, processId: BILLING },
      skipSmpRegistration: false,
      useTestNetwork: false,
    });

  it("replaces the previous document type on the SMP for every identifier", async () => {
    await changeToCreditNote();
    expect(serviceMetadataChanges().sort()).toEqual([
      `DELETE ${INVOICE}`,
      `DELETE ${INVOICE}`,
      `PUT ${CREDIT_NOTE}`,
      `PUT ${CREDIT_NOTE}`,
    ]);
    expect(await documentTypeRow()).toBe(CREDIT_NOTE);
  });

  it("leaves the published document type when Enhetsregisteret does not know the organisation", async () => {
    registerStatus = 404;
    await expect(changeToCreditNote()).rejects.toThrow("not registered in Enhetsregisteret");
    expect(serviceMetadataChanges()).toEqual([]);
    expect(await documentTypeRow()).toBe(INVOICE);
  });

  it("publishes the previous document type again when the SMP refuses the new one", async () => {
    refuseCreditNote = true;
    await expect(changeToCreditNote()).rejects.toThrow("Failed to register service metadata in SMP");
    expect(serviceMetadataChanges()).toEqual([
      `DELETE ${INVOICE}`,
      `DELETE ${INVOICE}`,
      `PUT ${CREDIT_NOTE}`,
      // What may have been published of the credit note is taken off, and the
      // invoice is published again for every identifier.
      `DELETE ${CREDIT_NOTE}`,
      `DELETE ${CREDIT_NOTE}`,
      `PUT ${INVOICE}`,
      `PUT ${INVOICE}`,
    ]);
    expect(await documentTypeRow()).toBe(INVOICE);
  });
});
