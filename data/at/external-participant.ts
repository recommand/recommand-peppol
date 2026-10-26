import { KycOnboardingError, readKycResponse } from '@peppol/data/at/kyc-onboarding-client';
import {
  SEND_ONLY_NOT_ON_NETWORK_BLOCK,
  SEND_ONLY_OWN_PARTICIPANT_BLOCK,
} from '@peppol/data/at/kyc-onboarding-state';

/**
 * A French company that keeps receiving through another platform sends through
 * Arratech as an EXTERNAL participant: Arratech files the mandate it sends under,
 * and leaves the company's Peppol and Annuaire registration with that platform.
 * Arratech only creates one for an identifier another provider already registered
 * on Peppol; a free identifier would start its receiving registration instead.
 */

type Request = (path: string, options: RequestInit) => Promise<Response>;

export type ArratechParticipantSummary = {
  id: string;
  participantIdentifier: string;
  status?: string;
  participantClass?: string;
};

/**
 * Finds the participant of our organisation for an identifier by listing them:
 * the search parameter does not reliably return EXTERNAL participants.
 */
export async function findOrganisationParticipant(
  request: Request,
  orgId: string,
  participantIdentifier: string,
): Promise<ArratechParticipantSummary | null> {
  let lastEvaluatedKey: string | undefined;
  const matches: ArratechParticipantSummary[] = [];
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (lastEvaluatedKey) params.set('lastEvaluatedKey', lastEvaluatedKey);
    const page = await readKycResponse<{
      items: ArratechParticipantSummary[];
      pagination?: { hasMore?: boolean; lastEvaluatedKey?: string };
    }>(await request(`/orgs/${orgId}/participants?${params}`, { method: 'GET' }));
    matches.push(...page.items.filter((item) => item.participantIdentifier === participantIdentifier));
    lastEvaluatedKey = page.pagination?.hasMore ? page.pagination.lastEvaluatedKey : undefined;
  } while (lastEvaluatedKey);
  if (matches.length > 1) {
    throw new KycOnboardingError(`Arratech holds several participants for ${participantIdentifier}.`);
  }
  return matches[0] ?? null;
}

/** Whether a provider has the identifier registered on the production Peppol network. */
export async function isRegisteredOnPeppol(
  request: Request,
  participantIdentifier: string,
): Promise<boolean> {
  const params = new URLSearchParams({ participantIdentifier, environment: 'PROD' });
  const response = await request(`/lookup?${params}`, { method: 'GET' });
  if (response.status === 404) return false;
  const body = await readKycResponse<unknown>(response);
  const hits = (Array.isArray(body) ? body : [body]) as {
    participantIdentifier?: string;
    accessPoints?: unknown[];
  }[];
  return hits.some(
    (hit) => hit?.participantIdentifier === participantIdentifier && (hit.accessPoints?.length ?? 0) > 0,
  );
}

/**
 * Returns the company's EXTERNAL participant, creating it when our organisation has
 * none. Refuses, without creating anything, an identifier that is free on Peppol or
 * held by us as a receiving participant. A create that does not come back EXTERNAL
 * is deleted again, so it cannot go on to a receiving registration.
 */
export async function ensureExternalParticipant({
  request,
  orgId,
  participantIdentifier,
  name,
  smpRef,
  apRef,
}: {
  request: Request;
  orgId: string;
  participantIdentifier: string;
  name: string;
  smpRef: string;
  apRef: string;
}): Promise<ArratechParticipantSummary> {
  const existing = await findOrganisationParticipant(request, orgId, participantIdentifier);
  if (existing) {
    if (existing.participantClass !== 'EXTERNAL') {
      throw new KycOnboardingError(SEND_ONLY_OWN_PARTICIPANT_BLOCK);
    }
    return existing;
  }
  if (!(await isRegisteredOnPeppol(request, participantIdentifier))) {
    throw new KycOnboardingError(SEND_ONLY_NOT_ON_NETWORK_BLOCK);
  }
  const created = await readKycResponse<ArratechParticipantSummary>(
    await request(`/orgs/${orgId}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        participantIdentifier,
        smpRef,
        apRef,
        transportProfile: 'peppol-transport-as4-v2_0',
        allowExternal: true,
      }),
    }),
  );
  if (created.participantClass !== 'EXTERNAL') {
    await readKycResponse(
      await request(`/orgs/${orgId}/participants/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [created.id] }),
      }),
    );
    throw new KycOnboardingError(SEND_ONLY_NOT_ON_NETWORK_BLOCK);
  }
  return created;
}

/** Fails until the EXTERNAL participant is active, retryably while it is still pending. */
export async function assertExternalParticipantActive(
  request: Request,
  orgId: string,
  participantId: string,
): Promise<void> {
  const participant = await readKycResponse<ArratechParticipantSummary>(
    await request(`/orgs/${orgId}/participants/${participantId}`, { method: 'GET' }),
  );
  if (participant.participantClass !== 'EXTERNAL') {
    throw new KycOnboardingError(`Participant ${participantId} is not EXTERNAL (${participant.participantClass ?? 'own'}).`);
  }
  if (participant.status !== 'ACTIVE') {
    throw new KycOnboardingError(
      `Participant ${participant.participantIdentifier} is ${participant.status ?? 'missing'}; waiting for Arratech activation.`,
      participant.status === 'PENDING_MANDATE',
    );
  }
}
