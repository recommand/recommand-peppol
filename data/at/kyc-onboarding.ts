import { audit, writeAuditEvent } from '@core/lib/audit';
import type { Context } from '@recommand/lib/api';
import { type Company, getCompanyById } from '@peppol/data/companies';
import { getCompanyIdentifiers } from '@peppol/data/company-identifiers';
import {
  finalizeCompanyVerification,
  getCompanyVerificationLog,
  isFinalVerificationStatus,
} from '@peppol/data/company-verification';
import { publishCompanyVerificationEvent } from '@peppol/data/company-verification-webhooks';
import { sendArratechKycReviewEmail } from '@peppol/data/send-arratech-kyc-review-email';
import {
  sendManualVerificationEmail,
  sendManualVerificationDeclinedEmail,
} from '@peppol/data/send-manual-verification-email';
import { getTeamExtension } from '@peppol/data/teams';
import { companyVerificationLog } from '@peppol/db/schema';
import { db } from '@recommand/db';
import type { Logger } from '@recommand/lib/logger';
import { Cron } from 'croner';
import { UserFacingError } from '@peppol/utils/util';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { fetchArratech, getArratechConfig } from '@peppol/data/at/client';
import { buildArratechKycFiling } from '@peppol/data/at/kyc';
import {
  ensureApprovedKyc,
  KycOnboardingError,
  type KycRecord,
  readKycResponse,
} from '@peppol/data/at/kyc-onboarding-client';
import {
  assertBlockedOnboardingResumable,
  sessionMatchesCompany,
  UNSUPPORTED_IDENTIFIER_BLOCK,
  type ArratechOnboarding,
} from '@peppol/data/at/kyc-onboarding-state';
import { findUnsupportedIdentifiers } from '@peppol/data/company-identifier-policy';
import { validateVerificationCountrySpecific } from '@peppol/types/verification-country-specific';
import { getParticipantByIdentifier, upsertCompanyRegistrations } from '@peppol/data/at/smp';
import {
  assertExternalParticipantActive,
  ensureExternalParticipant,
  findOrganisationParticipant,
} from '@peppol/data/at/external-participant';

import { withVerificationLock } from '@peppol/data/verification-lock';
import { getCurrentVerificationSession } from '@peppol/data/current-verification-session';
import { onboardingDiagnostics, type OnboardingLogger } from '@peppol/data/at/onboarding-diagnostics';
export { VerificationBusyError, withVerificationLock as withArratechVerificationLock } from '@peppol/data/verification-lock';

function request(path: string, options: RequestInit) {
  return fetchArratech(path, {
    ...options,
    useTestNetwork: false,
    signal: AbortSignal.timeout(30_000),
  });
}

export async function assertArratechCompanyActive(companyId: string): Promise<void> {
  const identifiers = await getCompanyIdentifiers(companyId);
  if (!identifiers.length) throw new KycOnboardingError('Company has no participant identifiers.');
  const config = getArratechConfig(false);
  for (const identifier of identifiers) {
    const participant = await getParticipantByIdentifier({ identifier, useTestNetwork: false });
    if (!participant || participant.status !== 'ACTIVE') {
      throw new KycOnboardingError(
        `Participant ${identifier.scheme}:${identifier.identifier} is ${participant?.status ?? 'missing'}; waiting for Arratech activation.`,
        true,
      );
    }
    if (identifier.scheme === '0225') {
      const kyc = await readKycResponse<KycRecord>(
        await request(`/orgs/${config.orgId}/participants/${participant.id}/kyc`, {
          method: 'GET',
        }),
      );
      if (kyc.status !== 'APPROVED')
        throw new KycOnboardingError(
          `KYC is ${kyc.status}; approval is required before completion.`,
        );
    }
  }
}

/**
 * Refuses until a send-only French company has an active EXTERNAL participant at
 * Arratech: without it, Arratech refuses every document the company sends.
 */
export async function assertArratechSenderActive(companyId: string): Promise<void> {
  const identifiers = await getCompanyIdentifiers(companyId);
  const sender = identifiers.find((identifier) => identifier.scheme === '0225' && /^\d{9}$/.test(identifier.identifier));
  if (!sender) throw new KycOnboardingError('Sending through Arratech requires a 0225 SIREN identifier.');
  const participantIdentifier = `0225:${sender.identifier}`;
  const config = getArratechConfig(false);
  const participant = await findOrganisationParticipant(request, config.orgId, participantIdentifier);
  if (!participant) {
    throw new KycOnboardingError(
      `${participantIdentifier} is not registered as a sender at Arratech; the send-only onboarding has to register it first.`,
    );
  }
  await assertExternalParticipantActive(request, config.orgId, participant.id);
}

async function saveState(
  id: string,
  state: ArratechOnboarding,
  errorMessage: string | null = null,
) {
  await db
    .update(companyVerificationLog)
    .set({ arratechOnboarding: state, errorMessage })
    .where(eq(companyVerificationLog.id, id));
}

export async function notifyVerificationCompletion(
  id: string,
  company: Company,
  state: ArratechOnboarding | null | undefined,
  status: 'verified' | 'rejected' = 'verified',
  context?: Context,
) {
  if (state?.phase === 'complete') return;
  await publishCompanyVerificationEvent({
    verificationEventId: id,
    teamId: company.teamId,
    companyId: company.id,
    status,
  });
  const event = {
    action: 'update',
    subsystem: context ? 'admin.company_verification' : 'peppol.company_verification',
    objectType: 'peppol.company',
    objectId: company.id,
    teamId: company.teamId,
    after: { verificationStatus: status },
    metadata: {
      verificationLogId: id,
      reason: context ? 'external_kyc_review' : 'arratech_activation',
    },
  };
  if (context) await audit(context, event);
  else await writeAuditEvent(event);
  if (state) {
    state.phase = 'complete';
    delete state.filing;
    await saveState(id, state);
  }
  try {
    const sendEmail =
      status === 'verified' ? sendManualVerificationEmail : sendManualVerificationDeclinedEmail;
    await sendEmail({ teamId: company.teamId, companyName: company.name });
  } catch (error) {
    console.error(`Could not send verification email for ${id}:`, error);
  }
}

async function notifySendOnlySupport(id: string, company: Company, state: ArratechOnboarding) {
  if (state.supportNotifiedAt) return;
  await sendArratechKycReviewEmail({
    companyId: company.id,
    companyName: company.name,
    verificationLogId: id,
    jurisdiction: company.country,
    useTestNetwork: false,
    sendOnly: true,
    submissionError:
      'This onboarding request requires manual review. Keep the verification pending until support completes the review.',
  });
  state.supportNotifiedAt = new Date().toISOString();
  await saveState(id, state);
}

/**
 * Registers a send-only company as an EXTERNAL participant, files the mandate it
 * signed as its KYC and approves it, then verifies the company once Arratech
 * reports the participant active. Its receiving registration stays with its own
 * platform, so nothing is registered in the Annuaire or on an SMP.
 */
async function onboardSendOnlyCompany(
  id: string,
  company: Company,
  state: ArratechOnboarding,
  filing: NonNullable<ArratechOnboarding['filing']>,
  diagnostic: ReturnType<typeof onboardingDiagnostics>,
) {
  if (company.accessPointProvider !== 'at-shared-ap-fr') {
    throw new KycOnboardingError('A send-only company is only onboarded with Arratech when it sends through Arratech.');
  }
  const config = getArratechConfig(false);
  const participantIdentifier = `0225:${filing.siren}`;
  if (!filing.addresses.includes(participantIdentifier)) {
    throw new KycOnboardingError(`Send-only onboarding requires the identifier ${participantIdentifier}.`);
  }
  if (state.phase === 'submit') {
    if (!state.external) {
      const participant = await diagnostic.step('ensure-external-participant', () => ensureExternalParticipant({
        request,
        orgId: config.orgId,
        participantIdentifier,
        name: company.name,
        smpRef: config.smpRef,
        apRef: config.apRef,
      }));
      state.external = { participantId: participant.id };
      await diagnostic.step('save-external', () => saveState(id, state));
    }
    await diagnostic.step('ensure-approved-kyc', () => ensureApprovedKyc({
      request,
      path: `/orgs/${config.orgId}/participants/${state.external!.participantId}/kyc`,
      siren: filing.siren,
      mandate: Buffer.from(filing.mandateBase64, 'base64'),
      fileName: filing.fileName,
    }));
    state.phase = 'activation';
    state.attempts = 0;
    await diagnostic.step('save-activation', () => saveState(id, state));
  }
  await diagnostic.step('check-activation', () => assertExternalParticipantActive(
    request, config.orgId, state.external!.participantId,
  ));
  const current = await diagnostic.step('reload-session', () => getCompanyVerificationLog(id));
  if (!current || isFinalVerificationStatus(current.status)) return;
  const result = await diagnostic.step('finalize-verification', () => finalizeCompanyVerification({
    companyVerificationLogId: id,
    company,
    status: 'verified',
    verificationProofReference: current.verificationProofReference!,
  }));
  if (result.status !== 'verified')
    throw new KycOnboardingError(result.errorMessage ?? 'Company activation failed.');
  await diagnostic.step('notify-completion', () => notifyVerificationCompletion(id, company, state));
}

export async function processArratechOnboarding(id: string, logger: OnboardingLogger = console): Promise<void> {
  const diagnostic = onboardingDiagnostics(logger, `session=${id}`);
  await diagnostic.step('locked-processing', () => withVerificationLock(id, async () => {
    diagnostic.emit('info', 'lock-acquired');
    const log = await diagnostic.step('load-session', () => getCompanyVerificationLog(id));
    if (!log?.arratechOnboarding) return;
    const state = log.arratechOnboarding;
    diagnostic.emit('info', `state phase=${state.phase} attempts=${state.attempts}`);
    if (state.phase === 'complete' || state.phase === 'blocked') return;
    const company = await diagnostic.step('load-company', () => getCompanyById(log.companyId));
    if (!company) return;
    if (log.status === 'verified') {
      await diagnostic.step('notify-completion', () => notifyVerificationCompletion(id, company, state));
      return;
    }
    if (isFinalVerificationStatus(log.status)) return;
    if (state.phase === 'support') {
      await diagnostic.step('notify-support', () => notifySendOnlySupport(id, company, state));
      return;
    }
    try {
      const team = await diagnostic.step('load-team', () => getTeamExtension(company.teamId));
      if (
        company.country !== 'FR' ||
        company.smpProvider !== 'at-shared-smp-fr' ||
        team?.useTestNetwork ||
        team?.isPlayground ||
        team?.verificationRequirements !== 'strict'
      ) {
        throw new KycOnboardingError(
          'Company settings changed; onboarding requires manual review.',
        );
      }
      if (
        !log.mandateAcceptedAt ||
        !log.verificationProofReference ||
        !log.firstName ||
        !log.lastName
      ) {
        throw new KycOnboardingError(
          'A signed mandate and completed identity verification are required.',
        );
      }
      if (!sessionMatchesCompany(log, company, state)) {
        throw new KycOnboardingError(
          'Company details changed since the mandate was signed; start a new verification.',
        );
      }
      const identifiers = await diagnostic.step('load-identifiers', () => getCompanyIdentifiers(company.id));
      // A send-only company is filed under its SIREN alone; the establishment SIRET
      // is only needed to register receiving addresses in the Annuaire.
      const sendOnly = !company.isSmpRecipient;
      const countrySpecific = validateVerificationCountrySpecific(
        company, log.countrySpecific ?? state.identitySupplement?.countrySpecific, !sendOnly,
      );
      if (state.identitySupplement &&
        (state.identitySupplement.countrySpecific.country !== countrySpecific?.country ||
          state.identitySupplement.countrySpecific.siret !== countrySpecific?.siret)) {
        throw new KycOnboardingError('Reviewed establishment data conflicts with the submitted verification.');
      }
      if (!identifiers.length || identifiers.some((identifier) => identifier.scheme !== '0225')) {
        throw new KycOnboardingError(UNSUPPORTED_IDENTIFIER_BLOCK);
      }
      if (!state.filing) {
        const filing = await diagnostic.step('build-filing', () => buildArratechKycFiling({
          company,
          countrySpecific,
          signatory: { firstName: log.firstName!, lastName: log.lastName! },
          signedAt: log.mandateAcceptedAt!,
          proofReference: log.verificationProofReference!,
          reference: log.id,
        }));
        const siren = filing.identity.metaData?.siren;
        const siret = filing.identity.metaData?.siret;
        if (!siren || (!sendOnly && (filing.identity.notes.length || !siret))) {
          throw new KycOnboardingError(
            `An explicit SIRET is required for automatic approval. ${filing.identity.notes.join(' ')}`,
          );
        }
        state.filing = {
          siren,
          ...(sendOnly ? {} : { siret }),
          addresses: filing.electronicAddresses,
          mandateBase64: filing.mandate.toString('base64'),
          fileName: filing.mandateFileName,
        };
        await diagnostic.step('save-filing', () => saveState(id, state));
      }
      const filing = state.filing;
      if (!sendOnly && filing.siret !== countrySpecific?.siret) {
        throw new KycOnboardingError('Establishment SIRET changed since the mandate was prepared.');
      }
      const addresses = identifiers
        .map((identifier) => `${identifier.scheme}:${identifier.identifier}`)
        .sort();
      if (JSON.stringify(addresses) !== JSON.stringify([...filing.addresses].sort())) {
        throw new KycOnboardingError(
          'Participant identifiers changed since the mandate was prepared.',
        );
      }
      if (sendOnly) {
        await onboardSendOnlyCompany(id, company, state, filing, diagnostic);
        return;
      }
      if (state.phase === 'submit') {
        await diagnostic.step('register-participants', () => upsertCompanyRegistrations({
          companyId: company.id,
          useTestNetwork: false,
          includeCapabilities: false,
          siret: filing.siret,
        }));
        const config = getArratechConfig(false);
        for (const identifier of identifiers) {
          const participant = await diagnostic.step('load-participant', () => getParticipantByIdentifier({
            identifier,
            useTestNetwork: false,
          }));
          if (!participant)
            throw new KycOnboardingError('Participant creation was not confirmed.', true);
          await diagnostic.step('ensure-approved-kyc', () => ensureApprovedKyc({
            request,
            path: `/orgs/${config.orgId}/participants/${participant.id}/kyc`,
            siren: filing.siren,
            siret: filing.siret,
            mandate: Buffer.from(filing.mandateBase64, 'base64'),
            fileName: filing.fileName,
          }));
        }
        state.phase = 'activation';
        state.attempts = 0;
        await diagnostic.step('save-activation', () => saveState(id, state));
      }
      await diagnostic.step('check-activation', () => assertArratechCompanyActive(company.id));
      await diagnostic.step('sync-capabilities', () => upsertCompanyRegistrations({ companyId: company.id, useTestNetwork: false }));
      const current = await diagnostic.step('reload-session', () => getCompanyVerificationLog(id));
      if (!current || isFinalVerificationStatus(current.status)) return;
      const result = await diagnostic.step('finalize-verification', () => finalizeCompanyVerification({
        companyVerificationLogId: id,
        company,
        status: 'verified',
        verificationProofReference: log.verificationProofReference!,
      }));
      if (result.status !== 'verified')
        throw new KycOnboardingError(result.errorMessage ?? 'Company activation failed.');
      await diagnostic.step('notify-completion', () => notifyVerificationCompletion(id, company, state));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof UserFacingError) && (!(error instanceof KycOnboardingError) || error.retryable);
      state.attempts++;
      diagnostic.emit('warn', `attempt-failed phase=${state.phase} attempts=${state.attempts} retryable=${retryable}`);
      const expired = Date.now() - Date.parse(state.resumedAt ?? state.startedAt) > 72 * 60 * 60 * 1000;
      if (!retryable || expired || (state.phase === 'submit' && state.attempts >= 12)) {
        state.phase = 'blocked';
        await diagnostic.step('save-blocked', () => saveState(id, state, message));
        await diagnostic.step('notify-blocked', () => sendArratechKycReviewEmail({
          companyId: company.id,
          companyName: company.name,
          verificationLogId: id,
          jurisdiction: company.country,
          useTestNetwork: false,
          sendOnly: !company.isSmpRecipient,
          submissionError: message,
          mandate: state.filing ? Buffer.from(state.filing.mandateBase64, 'base64') : undefined,
          mandateFileName: state.filing?.fileName,
        }));
      } else {
        state.nextAttemptAt = new Date(
          Date.now() + Math.min(30, 2 ** Math.min(state.attempts, 5)) * 60_000,
        ).toISOString();
        await diagnostic.step('save-retry', () => saveState(id, state, message));
      }
    }
  }));
}

async function isLatestVerificationSession(id: string, companyId: string): Promise<boolean> {
  return (await getCurrentVerificationSession(companyId))?.id === id;
}

/**
 * Hands a blocked onboarding back to the worker after support corrected what
 * blocked it. The identity check and mandate stay as they are; the worker takes it
 * from the first phase again, with the provider's own approval and activation.
 * Refuses, without writing, anything assertBlockedOnboardingResumable does not allow.
 */
export async function resumeBlockedArratechOnboarding(
  id: string,
  context: Context,
): Promise<{ companyId: string; teamId: string; state: ArratechOnboarding; previousError: string | null }> {
  return withVerificationLock(id, async () => {
    const log = await getCompanyVerificationLog(id);
    if (!log) throw new UserFacingError('Verification session not found');
    const company = await getCompanyById(log.companyId);
    if (!company) throw new UserFacingError('Company not found');
    const team = await getTeamExtension(company.teamId);
    const identifiers = await getCompanyIdentifiers(company.id);
    const state = assertBlockedOnboardingResumable({
      log,
      company,
      team,
      identifiers,
      isLatest: await isLatestVerificationSession(id, company.id),
      unsupportedIdentifiers: findUnsupportedIdentifiers(
        { smpProvider: company.smpProvider, isPlayground: team?.isPlayground, useTestNetwork: team?.useTestNetwork },
        identifiers,
      ),
    });
    await saveState(id, state);
    await audit(context, {
      action: 'update',
      subsystem: 'admin.company_verification',
      objectType: 'peppol.company_verification',
      objectId: id,
      teamId: company.teamId,
      before: { phase: 'blocked', errorMessage: log.errorMessage },
      after: { phase: state.phase, attempts: state.attempts, nextAttemptAt: state.nextAttemptAt },
      metadata: {
        companyId: company.id,
        reason: 'resume_blocked_onboarding',
        identifiers: identifiers.map((identifier) => `${identifier.scheme}:${identifier.identifier}`),
      },
    });
    return { companyId: company.id, teamId: company.teamId, state, previousError: log.errorMessage };
  });
}

export function initializeArratechOnboardingCron(logger: Logger): void {
  const diagnostic = onboardingDiagnostics(logger, 'scheduler');
  if (process.env.RUN_CRON !== 'true') {
    diagnostic.emit('info', 'disabled');
    return;
  }
  new Cron('* * * * *', {
    name: 'peppol.arratech-onboarding',
    protect: () => diagnostic.emit('warn', 'tick-skipped previous-batch-still-running'),
  }, async () => {
    diagnostic.emit('info', 'tick');
    try {
      const logs = await diagnostic.step('select-due', async () => db
        .select({ id: companyVerificationLog.id })
        .from(companyVerificationLog)
        .where(
          and(
            isNotNull(companyVerificationLog.arratechOnboarding),
            sql`(${companyVerificationLog.arratechOnboarding}->>'phase' in ('submit', 'activation') or (${companyVerificationLog.arratechOnboarding}->>'phase' = 'support' and ${companyVerificationLog.arratechOnboarding}->>'supportNotifiedAt' is null))`,
            sql`${companyVerificationLog.arratechOnboarding}->>'nextAttemptAt' <= ${new Date().toISOString()}`,
            sql`${companyVerificationLog.status} in ('inReview', 'verified')`,
          ),
        )
        .orderBy(sql`${companyVerificationLog.arratechOnboarding}->>'nextAttemptAt'`)
        .limit(25));
      diagnostic.emit('info', `selected count=${logs.length}`);
      for (const log of logs) {
        try {
          await processArratechOnboarding(log.id, logger);
        } catch (error) {
          logger.error(
            `Arratech onboarding ${log.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `Arratech onboarding worker failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      diagnostic.emit('info', 'batch-finished');
    }
  });
  diagnostic.emit('info', 'registered schedule=every-minute');
}
