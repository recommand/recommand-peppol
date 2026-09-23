import type { VerificationCountrySpecific } from '@peppol/types/verification-country-specific';

export type ArratechOnboarding = {
  phase: 'submit' | 'activation' | 'support' | 'complete' | 'blocked';
  supportNotifiedAt?: string;
  attempts: number;
  nextAttemptAt: string;
  startedAt: string;
  /**
   * Set when support resumed the onboarding after a block; the audit log has who
   * and why. The worker's time limit runs from here rather than from startedAt.
   */
  resumedAt?: string;
  identitySupplement?: {
    countrySpecific: VerificationCountrySpecific;
    source: string;
    reviewedBy: string;
    reviewedAt: string;
    verificationLogId: string;
  };
  filing?: {
    siren: string;
    siret: string;
    addresses: string[];
    mandateBase64: string;
    fileName: string;
  };
};

/** The block a company runs into when an identifier of it is not under the French scheme. */
export const UNSUPPORTED_IDENTIFIER_BLOCK = 'Automatic French onboarding requires 0225 participant identifiers.';

export function getArratechVerificationProgress(
  state: ArratechOnboarding | null | undefined,
  isSmpRecipient: boolean,
  status: string,
) {
  const pending = status === 'inReview' && !!state;
  return {
    activationPending:
      pending && isSmpRecipient && (state.phase === 'submit' || state.phase === 'activation'),
    supportReviewPending:
      pending && (!isSmpRecipient || state.phase === 'support' || state.phase === 'blocked'),
  };
}

type SessionSnapshot = {
  id: string;
  status: string;
  enterpriseNumber: string | null;
  companyName: string | null;
  country: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  mandateAcceptedAt: Date | null;
  verificationProofReference: string | null;
  firstName: string | null;
  lastName: string | null;
  errorMessage: string | null;
  arratechOnboarding: ArratechOnboarding | null | undefined;
};

type CompanySnapshot = {
  country: string;
  smpProvider: string;
  isSmpRecipient: boolean;
  name: string;
  enterpriseNumber: string | null;
  address: string;
  postalCode: string;
  city: string;
};

/**
 * Whether the company still reads as it did when the representative signed for it.
 * The mandate and the filing carry these details, so a change means a new session.
 */
export function sessionMatchesCompany(
  log: Pick<SessionSnapshot, 'id' | 'enterpriseNumber' | 'companyName' | 'country' | 'address' | 'postalCode' | 'city'>,
  company: Pick<CompanySnapshot, 'enterpriseNumber' | 'name' | 'country' | 'address' | 'postalCode' | 'city'>,
  state?: Pick<ArratechOnboarding, 'identitySupplement'> | null,
): boolean {
  return (
    log.enterpriseNumber === company.enterpriseNumber &&
    !(state?.identitySupplement && state.identitySupplement.verificationLogId !== log.id) &&
    log.companyName === company.name &&
    log.country === company.country &&
    log.address === company.address &&
    log.postalCode === company.postalCode &&
    log.city === company.city
  );
}

export class OnboardingResumeRefused extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
    this.name = 'OnboardingResumeRefused';
  }
}

/**
 * Decides whether a blocked onboarding can be handed back to the worker as it is.
 *
 * Resuming keeps the identity check and the signed mandate, so it is only right
 * when nothing they attest to has changed and nothing was filed with the provider
 * under the old state. That is the case for exactly one block: the worker refused
 * the company's identifiers before preparing a filing, and the identifiers have
 * since been corrected. Every other block, and any session that already prepared
 * a filing, keeps needing a person: either a new session or the provider's own
 * process.
 */
export function assertBlockedOnboardingResumable({
  log,
  company,
  team,
  identifiers,
  isLatest,
  unsupportedIdentifiers,
}: {
  log: SessionSnapshot;
  company: CompanySnapshot;
  team: { useTestNetwork?: boolean | null; isPlayground?: boolean | null; verificationRequirements?: string | null } | null | undefined;
  identifiers: readonly { scheme: string; identifier: string }[];
  isLatest: boolean;
  unsupportedIdentifiers: readonly { scheme: string; identifier: string }[];
}): ArratechOnboarding {
  const state = log.arratechOnboarding;
  if (log.status !== 'inReview' || !state) {
    throw new OnboardingResumeRefused(`Verification session is ${log.status} and not an onboarding under review.`, 400);
  }
  if (state.phase !== 'blocked') {
    throw new OnboardingResumeRefused(`Onboarding is in phase ${state.phase}; only a blocked onboarding can be resumed.`, 400);
  }
  if (!isLatest) {
    throw new OnboardingResumeRefused('A newer verification session exists. Review the latest session instead.', 409);
  }
  if (
    company.country !== 'FR' ||
    company.smpProvider !== 'at-shared-smp-fr' ||
    team?.useTestNetwork ||
    team?.isPlayground ||
    team?.verificationRequirements !== 'strict'
  ) {
    throw new OnboardingResumeRefused('Company settings no longer qualify for automatic onboarding; start a new verification.', 409);
  }
  if (!company.isSmpRecipient) {
    throw new OnboardingResumeRefused('Send-only companies are reviewed manually and cannot be resumed.', 409);
  }
  if (!log.mandateAcceptedAt || !log.verificationProofReference || !log.firstName || !log.lastName) {
    throw new OnboardingResumeRefused('The session has no completed identity check and signed mandate to resume with.', 409);
  }
  if (!sessionMatchesCompany(log, company, state)) {
    throw new OnboardingResumeRefused('Company details changed since the mandate was signed; start a new verification.', 409);
  }
  if (log.errorMessage !== UNSUPPORTED_IDENTIFIER_BLOCK) {
    throw new OnboardingResumeRefused(
      'Only an onboarding blocked on unsupported participant identifiers can be resumed; this block needs manual review.',
      409,
    );
  }
  if (state.filing) {
    throw new OnboardingResumeRefused(
      'A filing was already prepared for this session; resuming could contradict what the provider holds. Review it manually.',
      409,
    );
  }
  if (identifiers.length === 0) {
    throw new OnboardingResumeRefused('The company has no participant identifiers to onboard.', 409);
  }
  if (unsupportedIdentifiers.length > 0) {
    throw new OnboardingResumeRefused(
      `The company still has unsupported identifiers: ${unsupportedIdentifiers.map((identifier) => `${identifier.scheme}:${identifier.identifier}`).join(', ')}. Correct them first.`,
      409,
    );
  }
  // startedAt stays as evidence of when the session began; the worker's 72 hour
  // window runs from resumedAt instead, or an old session would block again on
  // its first wait.
  const now = new Date().toISOString();
  return {
    ...state,
    phase: 'submit',
    attempts: 0,
    nextAttemptAt: now,
    resumedAt: now,
  };
}
