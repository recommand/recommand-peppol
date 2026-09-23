import { publishEvent } from "@core/data/rules/events";
import type { Tx } from "@core/data/rules/db";
import { db } from "@recommand/db";
import type { Company } from "./companies";
import { lockCompanyRow } from "./company-row-lock";

export function companyEventPayload(company: Company) {
  return {
    companyId: company.id,
    name: company.name,
    address: company.address,
    postalCode: company.postalCode,
    city: company.city,
    country: company.country,
    enterpriseNumberScheme: company.enterpriseNumberScheme ?? null,
    enterpriseNumber: company.enterpriseNumber ?? null,
    vatNumber: company.vatNumber ?? null,
    email: company.email ?? null,
    phone: company.phone ?? null,
    isVerified: company.isVerified,
  };
}

/**
 * Company writes happen outside a transaction (they wrap SMP calls and manual
 * rollbacks), so two concurrent updates can commit as A then B and still reach
 * the log as B then A. To keep the log's last event equal to the row, the
 * payload is not the caller's copy: the row is locked and re-read inside the
 * transaction that appends the event. Publishes on one company serialize on
 * that lock, so a later log position always carries the same or newer state.
 * The idempotency key holds the row's updatedAt, so two publishes that see the
 * same state collapse into one event. A company that was deleted meanwhile is
 * covered by its deleted event and publishes nothing.
 */
async function publishCompanyStateEvent(
  type: "peppol.company.created.v1" | "peppol.company.updated.v1",
  companyId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const company = await lockCompanyRow(tx, companyId, "update");
    if (!company) {
      return;
    }
    const kind = type === "peppol.company.created.v1" ? "created" : "updated";
    await publishEvent(type, {
      teamId: company.teamId,
      streamId: company.id,
      aggregateType: "peppol.company",
      aggregateId: company.id,
      idempotencyKey:
        kind === "created"
          ? `peppol.company.created:${company.id}`
          : `peppol.company.updated:${company.id}:${company.updatedAt.toISOString()}`,
      payload: companyEventPayload(company),
      tx: tx as Tx,
    });
  });
}

export async function publishCompanyCreatedEvent(company: Company): Promise<void> {
  await publishCompanyStateEvent("peppol.company.created.v1", company.id);
}

export async function publishCompanyUpdatedEvent(company: Company): Promise<void> {
  await publishCompanyStateEvent("peppol.company.updated.v1", company.id);
}

export async function publishCompanyDeletedEvent(company: Company): Promise<void> {
  await publishEvent("peppol.company.deleted.v1", {
    teamId: company.teamId,
    streamId: company.id,
    aggregateType: "peppol.company",
    aggregateId: company.id,
    idempotencyKey: `peppol.company.deleted:${company.id}`,
    payload: { companyId: company.id },
  });
}
