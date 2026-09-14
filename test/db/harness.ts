import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

// The shared setup for the tests that run against a real PostgreSQL. What they are
// for is the part of the deliveries model that only a database can show: what two
// callers racing for the same row see, what survives a rollback, and what a query
// returns over rows that were actually written. The unit tests next to them fake the
// database module and can only show how the code reacts to answers it is handed.
//
// The tests skip themselves unless PEPPOL_TEST_DATABASE_URL points at a disposable
// database. To run them:
//
//   docker run -d --rm --name peppol-deliveries-test \
//     -e POSTGRES_PASSWORD=deliveries -e POSTGRES_DB=peppol_test \
//     -p 127.0.0.1:5439:5432 postgres:16-alpine
//   PEPPOL_TEST_DATABASE_URL=postgres://postgres:deliveries@127.0.0.1:5439/peppol_test \
//     bun run test:db
//   docker stop peppol-deliveries-test

export const testDatabaseUrl = process.env.PEPPOL_TEST_DATABASE_URL;

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packagesDirectory = join(packageDirectory, "..");

// The packages this one's tables need: the framework's migration bookkeeping, the
// core tables peppol's foreign keys point at, and peppol's own. The other packages
// are left out because they are not needed here and some of them own tables peppol
// also creates, which the server resolves by loading only one of the two.
const MIGRATED_PACKAGES = ["framework", "core", "peppol"] as const;

/**
 * The migrations in the order the server applies them: the framework's first, then
 * the rest by filename, so a package that references another's tables finds them.
 * Reading them from the packages themselves keeps the test schema the one production
 * has rather than a hand-kept copy.
 */
async function migrationFiles(): Promise<string[]> {
  const collect = async (name: string) => {
    const directory = join(packagesDirectory, name, "db", "drizzle");
    const files = await readdir(directory);
    return files.filter((file) => file.endsWith(".sql")).sort().map((file) => join(directory, file));
  };
  const framework = await collect("framework");
  const others = (
    await Promise.all(MIGRATED_PACKAGES.filter((name) => name !== "framework").map(collect))
  )
    .flat()
    .sort((left, right) => left.localeCompare(right));
  return [...framework, ...others];
}

/**
 * An empty database with the current schema. The connection is refused unless it
 * names a local database whose name ends in `_test`: everything here drops and
 * truncates, and it must never be able to do that to a database someone uses.
 */
export async function connectTestDatabase(): Promise<Pool> {
  const url = new URL(testDatabaseUrl!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.endsWith("_test")) {
    throw new Error("Use a disposable database on localhost whose name ends in _test");
  }
  const pool = new Pool({ connectionString: testDatabaseUrl });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  for (const file of await migrationFiles()) {
    await pool.query(await readFile(file, "utf-8"));
  }
  return pool;
}

export const TEAM_ID = "team_db_test";
export const COMPANY_ID = "cmp_db_test";

/** The one team and company every document in these tests belongs to. */
export async function seedTeamAndCompany(pool: Pool, options: { useTestNetwork?: boolean } = {}) {
  await pool.query(
    `INSERT INTO teams (id, name) VALUES ($1, 'Delivery tests') ON CONFLICT (id) DO NOTHING`,
    [TEAM_ID]
  );
  await pool.query(
    `INSERT INTO peppol_team_extensions (id, is_playground, use_test_network) VALUES ($1, false, $2)
     ON CONFLICT (id) DO UPDATE SET use_test_network = excluded.use_test_network`,
    [TEAM_ID, options.useTestNetwork ?? false]
  );
  await pool.query(
    `INSERT INTO peppol_companies (id, team_id, name, address, postal_code, city, country, access_point_provider, smp_provider)
     VALUES ($1, $2, 'Example SARL', '1 Rue', '75001', 'Paris', 'FR', 'at-shared-ap-fr', 'at-shared-smp-fr')
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_ID, TEAM_ID]
  );
}

/** A rule whose webhook action turns every delivery status event into a stored row. */
export async function seedDeliveryStatusRule(pool: Pool, id = "rule_delivery_status") {
  await pool.query(
    `INSERT INTO rules (id, team_id, name, enabled, event_type, condition, actions, schema_version)
     VALUES ($1, $2, 'Delivery status', true, 'peppol.document.delivery_status.v1', null, $3, 1)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      TEAM_ID,
      JSON.stringify([
        { type: "webhook", version: 1, config: { url: "https://example.com/hook" } },
      ]),
    ]
  );
  return id;
}

/** Everything the tests write, emptied between them; the team and company stay. */
export async function truncateDocumentData(pool: Pool) {
  await pool.query(
    `TRUNCATE peppol_transmitted_documents, peppol_document_deliveries, peppol_provider_delivery_reports,
              rule_action_deliveries, audit_events, peppol_transfer_events CASCADE`
  );
}

export type SeedDocument = {
  id: string;
  direction?: "incoming" | "outgoing";
  receiverId?: string | null;
  sentOverPeppol?: boolean;
  sentOverEmail?: boolean;
  emailRecipients?: string[];
  emailFallback?: Record<string, unknown> | null;
  accessPointProvider?: string;
  apTransactionId?: string | null;
  externalReferenceId?: string | null;
  envelopeId?: string | null;
  createdAt?: Date;
};

export async function seedDocument(pool: Pool, document: SeedDocument) {
  await pool.query(
    `INSERT INTO peppol_transmitted_documents
       (id, team_id, company_id, direction, sender_id, receiver_id, doc_type_id, process_id, country_c1,
        access_point_provider, smp_provider, sent_over_peppol, sent_over_email, email_recipients, email_fallback,
        ap_transaction_id, external_reference_id, envelope_id, type, xml_location, attachments_location, created_at)
     VALUES ($1, $2, $3, $4, '0225:123456789', $5, 'doc-type', 'process', 'FR',
             $6, 'at-shared-smp-fr', $7, $8, $9, $10, $11, $12, $13, 'invoice', 'none', 'none', $14)`,
    [
      document.id,
      TEAM_ID,
      COMPANY_ID,
      document.direction ?? "outgoing",
      document.receiverId === undefined ? "0208:987654321" : document.receiverId,
      document.accessPointProvider ?? "recommand-ap1",
      document.sentOverPeppol ?? true,
      document.sentOverEmail ?? false,
      document.emailRecipients ?? [],
      document.emailFallback ? JSON.stringify(document.emailFallback) : null,
      document.apTransactionId ?? null,
      document.externalReferenceId ?? null,
      document.envelopeId ?? null,
      document.createdAt ?? new Date("2026-03-01T10:00:00Z"),
    ]
  );
}

export type SeedDelivery = {
  id: string;
  documentId: string;
  channel?: "peppol" | "email";
  address?: string;
  status?: "pending" | "delivered" | "failed";
  provider?: string | null;
  providerTransactionId?: string | null;
  failureCategory?: string | null;
};

export async function seedDelivery(pool: Pool, delivery: SeedDelivery) {
  await pool.query(
    `INSERT INTO peppol_document_deliveries
       (id, transmitted_document_id, team_id, company_id, channel, address, status, provider, provider_transaction_id, failure_category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      delivery.id,
      delivery.documentId,
      TEAM_ID,
      COMPANY_ID,
      delivery.channel ?? "peppol",
      delivery.address ?? "0208:987654321",
      delivery.status ?? "pending",
      delivery.provider ?? null,
      delivery.providerTransactionId ?? null,
      delivery.failureCategory ?? null,
    ]
  );
}

export async function deliveryRows(pool: Pool, documentId?: string) {
  const { rows } = documentId
    ? await pool.query(
        `SELECT id, channel, address, status, provider, provider_transaction_id AS "providerTransactionId",
                failure_category AS "failureCategory", failure_message AS "failureMessage",
                failure_provider_code AS "failureProviderCode", status_changed_at AS "statusChangedAt",
                created_at AS "createdAt", use_test_network AS "useTestNetwork"
         FROM peppol_document_deliveries WHERE transmitted_document_id = $1 ORDER BY channel, address`,
        [documentId]
      )
    : await pool.query(
        `SELECT id, transmitted_document_id AS "documentId", channel, address, status
         FROM peppol_document_deliveries ORDER BY transmitted_document_id, channel, address`
      );
  return rows;
}

/** The rows the rules engine wrote for delivery status events: the customer's copy. */
export async function deliveryStatusEventRows(pool: Pool) {
  const { rows } = await pool.query(
    `SELECT id, event_id AS "eventId", idempotency_key AS "idempotencyKey", payload
     FROM rule_action_deliveries WHERE event_type = 'peppol.document.delivery_status.v1' ORDER BY created_at, id`
  );
  return rows as { id: string; eventId: string; idempotencyKey: string; payload: { payload: Record<string, unknown> } }[];
}
