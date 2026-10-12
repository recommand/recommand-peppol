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

test('send-only shows activation while the worker registers it as a sender', () => {
  expect(getArratechVerificationProgress(state('submit'), 'inReview')).toEqual({
    activationPending: true,
    supportReviewPending: false,
  });
  expect(getArratechVerificationProgress(state('blocked'), 'inReview')).toEqual({
    activationPending: false,
    supportReviewPending: true,
  });
  expect(getArratechVerificationProgress(state('support'), 'inReview')).toEqual({
    activationPending: false,
    supportReviewPending: true,
  });
});

test('shows activation only while automatic processing is pending', () => {
  expect(getArratechVerificationProgress(state('activation'), 'inReview')).toEqual({
    activationPending: true,
    supportReviewPending: false,
  });
  expect(getArratechVerificationProgress(state('blocked'), 'inReview')).toEqual({
    activationPending: false,
    supportReviewPending: true,
  });
});

test('ordinary reviews and completed sessions have no pending platform state', () => {
  expect(getArratechVerificationProgress(null, 'inReview')).toEqual({
    activationPending: false,
    supportReviewPending: false,
  });
  expect(getArratechVerificationProgress(state('support'), 'verified')).toEqual({
    activationPending: false,
    supportReviewPending: false,
  });
});
