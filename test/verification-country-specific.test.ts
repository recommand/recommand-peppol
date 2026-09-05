import { describe, expect, it } from 'bun:test';
import { getVerificationCountryRequirements, validateVerificationCountrySpecific, verificationCountrySpecificSchema } from '../types/verification-country-specific';

const company = { country: 'FR', enterpriseNumber: '303265045' };
describe('country-specific verification input', () => {
  it('normalizes and validates an explicit establishment', () => {
    expect(validateVerificationCountrySpecific(company, { country: 'FR', siret: '303 265 045 00011' }, true))
      .toEqual({ country: 'FR', siret: '30326504500011' });
  });
  it('leaves other countries and optional send-only data unchanged', () => {
    expect(getVerificationCountryRequirements('BE', false, true)).toBeNull();
    expect(getVerificationCountryRequirements('FR', false, true)).toBeNull();
    expect(getVerificationCountryRequirements('FR', true, false)).toEqual({ country: 'FR', required: false });
    expect(validateVerificationCountrySpecific({ country: 'BE', enterpriseNumber: null }, undefined)).toBeNull();
    expect(validateVerificationCountrySpecific(company, undefined, false)).toBeNull();
  });
  it('requires an establishment for French receiving mandates', () => {
    expect(getVerificationCountryRequirements('FR', true, true)).toEqual({ country: 'FR', required: true });
    expect(() => validateVerificationCountrySpecific(company, undefined, true)).toThrow('required');
  });
  it('rejects country mismatches, wrong SIREN, malformed values and unknown metadata', () => {
    expect(() => validateVerificationCountrySpecific({ country: 'BE', enterpriseNumber: '303265045' }, { country: 'FR', siret: '30326504500011' })).toThrow('country');
    for (const value of [
      { country: 'FR', siret: '00000001800002' }, { country: 'FR', siret: '303265045' },
      { country: 'FR', siret: '30326504500012' }, { country: 'BE', siret: '30326504500011' },
      { country: 'FR', siret: '30326504500011', arbitrary: true },
    ]) expect(() => validateVerificationCountrySpecific(company, value)).toThrow();
  });
  it('does not mutate the company or submitted object', () => {
    const input = { country: 'FR', siret: '303 265 045 00011' };
    validateVerificationCountrySpecific(company, input);
    expect(input.siret).toBe('303 265 045 00011');
    expect(company).not.toHaveProperty('siret');
    expect(verificationCountrySpecificSchema.safeParse({ country: 'FR', siret: '' }).success).toBe(false);
  });
});
