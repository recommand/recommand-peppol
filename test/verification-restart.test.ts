import { describe, expect, it } from 'bun:test';
import { restartVerificationIdentity } from '../data/verification-submission';

describe('identity verification restart', () => {
  it('returns a provider link only after confirming the session is still pending', async () => {
    const events: string[] = [];
    expect(await restartVerificationIdentity({
      startIdentityVerification: async () => {events.push('start'); return 'https://example.com/verify';},
      confirmStillPending: async () => {events.push('confirm'); return true;},
    })).toBe('https://example.com/verify');
    expect(events).toEqual(['start','confirm']);
  });
  it('rejects a stale link when the session was closed while the provider was responding', async () => {
    await expect(restartVerificationIdentity({
      startIdentityVerification: async () => 'https://example.com/stale',
      confirmStillPending: async () => false,
    })).rejects.toThrow('Please use the latest verification request');
  });
  it('does not confirm or change state when the provider fails', async () => {
    let confirmed = false;
    await expect(restartVerificationIdentity({
      startIdentityVerification: async () => {throw new Error('Provider unavailable');},
      confirmStillPending: async () => {confirmed = true; return true;},
    })).rejects.toThrow('Provider unavailable');
    expect(confirmed).toBe(false);
  });
});
