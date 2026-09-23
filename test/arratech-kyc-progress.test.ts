import { expect, test } from 'bun:test';
import {
  getArratechVerificationProgress,
  type ArratechOnboarding,
} from '@peppol/data/at/kyc-onboarding-state';

const state = (phase: ArratechOnboarding['phase']): ArratechOnboarding => ({
  phase,
  attempts: 0,
  startedAt: '',
  nextAttemptAt: '',
});

test('send-only shows support processing even before the worker runs', () => {
  expect(getArratechVerificationProgress(state('submit'), false, 'inReview')).toEqual({
    activationPending: false,
    supportReviewPending: true,
  });
});

test('receiving shows activation only while automatic processing is pending', () => {
  expect(getArratechVerificationProgress(state('activation'), true, 'inReview')).toEqual({
    activationPending: true,
    supportReviewPending: false,
  });
  expect(getArratechVerificationProgress(state('blocked'), true, 'inReview')).toEqual({
    activationPending: false,
    supportReviewPending: true,
  });
});

test('ordinary reviews and completed sessions have no pending platform state', () => {
  expect(getArratechVerificationProgress(null, true, 'inReview')).toEqual({
    activationPending: false,
    supportReviewPending: false,
  });
  expect(getArratechVerificationProgress(state('support'), false, 'verified')).toEqual({
    activationPending: false,
    supportReviewPending: false,
  });
});
