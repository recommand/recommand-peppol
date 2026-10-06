import { describe, expect, it, mock, spyOn } from 'bun:test';

// Onboarding starts the first company from details another package knows about the
// team's business, such as its billing details. Those only help when they describe a
// company the team can create: a business in a country companies cannot be created
// in pays, but does not send, so none of its details are carried over.

mock.module('@recommand/db', () => ({ db: {} }));
const { resolveCompanyPrefill, setCompanyPrefillSource } = await import(
  '../lib/client/company-prefill'
);
const { createCompany } = await import('../data/companies');
const { UserFacingError } = await import('../utils/util');

const business = {
  name: 'Example Ltd',
  address: 'Main Street 1',
  postalCode: '1000',
  city: 'Capital',
};

function offer(country: string) {
  const prefill = {
    notice: 'Some fields have been pre-filled from your billing profile.',
    values: { ...business, country, vatNumber: `${country}123456789` } as any,
  };
  setCompanyPrefillSource(async () => prefill);
  return prefill;
}

describe('company prefill', () => {
  it('offers the details of a business in a supported country as they are', async () => {
    const prefill = offer('BE');
    expect(await resolveCompanyPrefill('team')).toEqual(prefill);
  });

  it('offers the details of a business in a partially supported country as they are', async () => {
    const prefill = offer('HR');
    expect(await resolveCompanyPrefill('team')).toEqual(prefill);
  });

  it('offers nothing from a business in an unsupported country and leaves the country to choose', async () => {
    offer('BG');
    const resolved = await resolveCompanyPrefill('team');
    expect(resolved).toEqual({ values: { country: undefined } });
    expect(Object.hasOwn(resolved?.values ?? {}, 'country')).toBe(true);
    expect(resolved?.notice).toBeUndefined();
  });

  it('offers nothing when the source fails', async () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    setCompanyPrefillSource(async () => {
      throw new Error('unavailable');
    });
    expect(await resolveCompanyPrefill('team')).toBeNull();
    logged.mockRestore();
  });
});

describe('creating a company in an unsupported country', () => {
  it('is refused as an error about the country field', async () => {
    const attempt = createCompany({
      teamId: 'team',
      ...business,
      country: 'BG',
      vatNumber: 'BG123456789',
      enterpriseNumber: null,
      enterpriseNumberScheme: null,
      email: null,
      phone: null,
      isSmpRecipient: true,
      skipDefaultCompanySetup: false,
    } as any);
    const error = await attempt.catch((caught) => caught);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.field).toBe('country');
    expect(error.message).toContain('not supported yet');
  });
});
