import { publishEvent } from "@core/data/rules/events";
import type { Company } from "./companies";

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

export async function publishCompanyCreatedEvent(company: Company): Promise<void> {
  await publishEvent("peppol.company.created.v1", {
    teamId: company.teamId,
    streamId: company.id,
    aggregateType: "peppol.company",
    aggregateId: company.id,
    idempotencyKey: `peppol.company.created:${company.id}`,
    payload: companyEventPayload(company),
  });
}

export async function publishCompanyUpdatedEvent(company: Company): Promise<void> {
  await publishEvent("peppol.company.updated.v1", {
    teamId: company.teamId,
    streamId: company.id,
    aggregateType: "peppol.company",
    aggregateId: company.id,
    idempotencyKey: `peppol.company.updated:${company.id}:${company.updatedAt.toISOString()}`,
    payload: companyEventPayload(company),
  });
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
