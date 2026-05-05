import { publishEvent } from "@core/data/rules/events";

export type CompanyVerificationWebhookStatus = "verified" | "rejected" | "error";

export async function publishCompanyVerificationEvent({
  verificationEventId,
  teamId,
  companyId,
  status,
  errorMessage,
}: {
  verificationEventId: string;
  teamId: string;
  companyId: string;
  status: CompanyVerificationWebhookStatus;
  errorMessage?: string | null;
}): Promise<void> {
  await publishEvent("peppol.company.verification.v1", {
    teamId,
    aggregateType: "peppol.company",
    aggregateId: companyId,
    idempotencyKey: `peppol.company.verification:${verificationEventId}:${status}`,
    payload: Object.fromEntries(
      Object.entries({
        companyId,
        status,
        errorMessage: errorMessage ?? null,
      }).filter(([, value]) => value !== undefined)
    ),
  });
}
