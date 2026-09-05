import type { VerificationCountrySpecific } from '@peppol/types/verification-country-specific';

export type ArratechOnboarding = {
  phase: 'submit' | 'activation' | 'support' | 'complete' | 'blocked';
  supportNotifiedAt?: string;
  attempts: number;
  nextAttemptAt: string;
  startedAt: string;
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
