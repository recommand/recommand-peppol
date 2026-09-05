import { describe, expect, it } from 'bun:test';
import { submitVerificationIdentity, type VerificationSubmission } from '../data/verification-submission';

const input = {
  company: { country: 'FR', enterpriseNumber: '303265045', isSmpRecipient: true },
  firstName: 'Jean', lastName: 'Dupont', mandateRequired: true, mandateAccepted: true,
  countrySpecific: { country: 'FR' as const, siret: '303 265 045 00011' },
};

function storage() {
  let saved: VerificationSubmission | undefined;
  let starts = 0;
  let failStart = false;
  return {
    get saved() { return saved; },
    get starts() { return starts; },
    set failStart(value: boolean) { failStart = value; },
    dependencies: {
      claimOpenedSubmission: async (snapshot: VerificationSubmission) => {
        if (saved) return false;
        saved = structuredClone(snapshot);
        return true;
      },
      startIdentityVerification: async () => {
        expect(saved).toBeDefined();
        starts++;
        if (failStart) throw new Error('Identity provider unavailable');
        return 'https://identity.example/session';
      },
    },
  };
}

describe('verification submission', () => {
  it('stores normalized country data before starting identity verification', async () => {
    const store = storage();
    expect(await submitVerificationIdentity(input, store.dependencies)).toBe('https://identity.example/session');
    expect(store.saved?.countrySpecific).toEqual({ country: 'FR', siret: '30326504500011' });
    expect(store.saved?.mandateAcceptedAt).toBeInstanceOf(Date);
    expect(input.company).not.toHaveProperty('siret');
  });
  it('rejects invalid or missing details before claiming or starting', async () => {
    for (const payload of [{ ...input, countrySpecific: null }, { ...input, mandateAccepted: false },
      { ...input, countrySpecific: { country: 'FR' as const, siret: '00000001800002' } }]) {
      const store = storage();
      await expect(submitVerificationIdentity(payload, store.dependencies)).rejects.toThrow();
      expect(store.saved).toBeUndefined();
      expect(store.starts).toBe(0);
    }
  });
  it('does not overwrite a submitted snapshot or start identity twice', async () => {
    const store = storage();
    await submitVerificationIdentity(input, store.dependencies);
    const saved = structuredClone(store.saved);
    await expect(submitVerificationIdentity({ ...input, firstName: 'Other' }, store.dependencies)).rejects.toThrow('already been submitted');
    expect(store.saved).toEqual(saved);
    expect(store.starts).toBe(1);
  });
  it('only starts one identity check for concurrent submissions', async () => {
    const store = storage();
    const results = await Promise.allSettled([
      submitVerificationIdentity(input, store.dependencies), submitVerificationIdentity(input, store.dependencies),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(store.starts).toBe(1);
  });
  it('preserves signed details when the provider fails, for the restart flow', async () => {
    const store = storage(); store.failStart = true;
    await expect(submitVerificationIdentity(input, store.dependencies)).rejects.toThrow('unavailable');
    expect(store.saved?.countrySpecific?.siret).toBe('30326504500011');
    await expect(submitVerificationIdentity(input, store.dependencies)).rejects.toThrow('already been submitted');
  });
  it('does not require French data for other countries or send-only requests', async () => {
    const store = storage();
    await submitVerificationIdentity({ ...input, company: { country: 'NL', enterpriseNumber: null, isSmpRecipient: true },
      mandateRequired: false, mandateAccepted: false, countrySpecific: null }, store.dependencies);
    expect(store.saved?.countrySpecific).toBeNull();
    expect(store.saved?.mandateAcceptedAt).toBeNull();
    const sendOnly = storage();
    await submitVerificationIdentity({ ...input, company: { ...input.company, isSmpRecipient: false }, countrySpecific: null }, sendOnly.dependencies);
    expect(sendOnly.saved?.countrySpecific).toBeNull();
  });
});
