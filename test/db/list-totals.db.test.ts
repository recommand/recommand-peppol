import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedDocument, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// A list's total is the number the API describes, not the string a PostgreSQL
// `bigint` count arrives as.

let pool: Pool;
let customers: typeof import("../../data/customers");
let integrations: typeof import("../../data/integrations");
let suppliers: typeof import("../../data/suppliers");
let transmittedDocuments: typeof import("../../data/transmitted-documents");

describe.skipIf(!testDatabaseUrl)("list totals against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    customers = await import("../../data/customers");
    integrations = await import("../../data/integrations");
    suppliers = await import("../../data/suppliers");
    transmittedDocuments = await import("../../data/transmitted-documents");
    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("counts documents as a number", async () => {
    await seedDocument(pool, { id: "doc_one" });
    await seedDocument(pool, { id: "doc_two" });

    expect((await transmittedDocuments.getTransmittedDocuments(TEAM_ID, { limit: 1 })).total).toBe(2);
  });

  it("counts customers as a number", async () => {
    await pool.query(
      `INSERT INTO supporting_data_customers (id, team_id, name, address, city, postal_code, country)
       VALUES ('cus_one', $1, 'Buyer BV', 'Kouter 1', 'Gent', '9000', 'BE'), ('cus_two', $1, 'Other BV', 'Kouter 2', 'Gent', '9000', 'BE')`,
      [TEAM_ID]
    );

    expect((await customers.getCustomers(TEAM_ID, { limit: 1 })).total).toBe(2);
  });

  it("counts suppliers as a number", async () => {
    await pool.query(
      `INSERT INTO supporting_data_suppliers (id, team_id, name) VALUES ('sup_one', $1, 'Seller BV'), ('sup_two', $1, 'Other BV')`,
      [TEAM_ID]
    );

    expect((await suppliers.getSuppliers(TEAM_ID, { limit: 1 })).total).toBe(2);
  });

  it("counts integration task logs as a number", async () => {
    await pool.query(
      `INSERT INTO activated_integrations (id, team_id, company_id, manifest, state) VALUES ('int_one', $1, $2, '{}', '{}')`,
      [TEAM_ID, COMPANY_ID]
    );
    await pool.query(
      `INSERT INTO integration_task_logs (id, integration_id, event, task, success, message, context)
       VALUES ('log_one', 'int_one', 'document.received', 'forward', true, 'Done', '{}'), ('log_two', 'int_one', 'document.received', 'forward', true, 'Done', '{}')`
    );

    expect((await integrations.getIntegrationTaskLogs(TEAM_ID, "int_one", { limit: 1 })).total).toBe(2);
  });
});
