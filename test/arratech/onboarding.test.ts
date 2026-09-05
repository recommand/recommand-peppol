import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ArratechOnboarding } from '../../data/at/kyc-onboarding-state';

const events: string[] = [];
let log: any;
let participantStatus: string;
let kycStatus: string;
let company: any;
let team: any;
let acquired: boolean;
let failSync: boolean;
let failEmail: boolean;
let failSupport: boolean;
let mandateNotes: string[];
const state = (): ArratechOnboarding => ({
  phase: 'submit',
  attempts: 0,
  nextAttemptAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
});

mock.module('@recommand/db', () => ({
  db: {
    transaction: async (fn: any) => fn({ execute: async () => ({ rows: [{ acquired }] }) }),
    update: () => ({
      set: (patch: any) => ({
        where: async () => {
          Object.assign(log, structuredClone(patch));
        },
      }),
    }),
  },
}));
mock.module('@peppol/data/companies', () => ({ getCompanyById: async () => company }));
mock.module('@peppol/data/teams', () => ({ getTeamExtension: async () => team }));
mock.module('@peppol/data/company-identifiers', () => ({
  getCompanyIdentifiers: async () => [{ scheme: '0225', identifier: '303265045' }],
}));
mock.module('@peppol/data/company-verification', () => ({
  getCompanyVerificationLog: async () => structuredClone(log),
  isFinalVerificationStatus: (status: string) => ['verified', 'rejected', 'error'].includes(status),
  finalizeCompanyVerification: async () => {
    events.push('finalize');
    log.status = 'verified';
    return { status: 'verified', errorMessage: null };
  },
}));
mock.module('@core/lib/audit', () => ({
  audit: async () => {
    events.push('audit');
  },
  writeAuditEvent: async () => {
    events.push('audit');
  },
}));
mock.module('@peppol/data/company-verification-webhooks', () => ({
  publishCompanyVerificationEvent: async () => {},
}));
mock.module('@peppol/data/send-manual-verification-email', () => ({
  sendManualVerificationEmail: async () => {
    events.push('email');
    if (failEmail) throw new Error('Mail unavailable');
  },
  sendManualVerificationDeclinedEmail: async () => {
    events.push('declined-email');
  },
}));
mock.module('@peppol/data/send-arratech-kyc-review-email', () => ({
  sendArratechKycReviewEmail: async () => {
    events.push('support');
    if (failSupport) throw new Error('Support mail unavailable');
  },
}));
mock.module('@peppol/data/at/kyc', () => ({
  buildArratechKycFiling: async () => ({
    identity: { metaData: { siren: '303265045', siret: '30326504500011' }, notes: mandateNotes },
    electronicAddresses: ['0225:303265045'],
    mandate: Buffer.from('%PDF signed'),
    mandateFileName: 'mandate.pdf',
  }),
}));
mock.module('@peppol/data/at/smp', () => ({
  getParticipantByIdentifier: async () => ({ id: 'participant', status: participantStatus }),
  upsertCompanyRegistrations: async (options: any) => {
    if (options.includeCapabilities === false) {
      expect(options.siret).toBe('30326504500011');
      events.push('register');
    } else {
      events.push('sync');
      if (failSync) throw new Error('SMP temporarily unavailable');
    }
  },
}));
mock.module('@peppol/data/at/client', () => ({
  getArratechConfig: () => ({ orgId: 'org' }),
  fetchArratech: async (path: string, options: RequestInit) => {
    if (path.endsWith('/approve')) {
      events.push('approve');
      kycStatus = 'APPROVED';
    } else if (path.endsWith('/documents')) {
      events.push('upload');
      return Response.json({ docId: 'doc' }, { status: 201 });
    } else expect(options.method).toBe('GET');
    return Response.json({
      status: kycStatus,
      jurisdiction: 'FR',
      metaData: { siren: '303265045', siret: '30326504500011' },
      documents: [],
    });
  },
}));

const { processArratechOnboarding, notifyVerificationCompletion, VerificationBusyError } =
  await import('../../data/at/kyc-onboarding');

beforeEach(() => {
  events.length = 0;
  log = {
    id: 'verification',
    companyId: 'company',
    status: 'inReview',
    firstName: 'Jean',
    lastName: 'Dupont',
    companyName: 'Company',
    enterpriseNumber: '303265045',
    countrySpecific: { country: 'FR', siret: '30326504500011' },
    country: 'FR',
    address: 'Street',
    postalCode: '75001',
    city: 'Paris',
    mandateAcceptedAt: new Date(),
    verificationProofReference: 'didit-session',
    arratechOnboarding: state(),
  };
  company = {
    id: 'company',
    teamId: 'team',
    country: 'FR',
    smpProvider: 'at-shared-smp-fr',
    isSmpRecipient: true,
    name: log.companyName,
    enterpriseNumber: log.enterpriseNumber,
    address: log.address,
    postalCode: log.postalCode,
    city: log.city,
  };
  team = { verificationRequirements: 'strict', useTestNetwork: false, isPlayground: false };
  participantStatus = 'PENDING_TAX_REGISTRATION';
  kycStatus = 'PENDING';
  acquired = true;
  failSync = false;
  failEmail = false;
  failSupport = false;
  mandateNotes = [];
});

describe('durable Arratech onboarding', () => {
  it('blocks a mismatched country before any provider writes', async () => {
    log.countrySpecific = { country: 'BE', siret: '30326504500011' };
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['support']);
    expect(log.arratechOnboarding.phase).toBe('blocked');
  });

  it('does not let a supplement override submitted country data', async () => {
    log.arratechOnboarding.identitySupplement = {
      countrySpecific: { country: 'FR', siret: '00000001800002' }, source: 'confirmation', reviewedBy: 'support',
      reviewedAt: new Date().toISOString(), verificationLogId: log.id,
    };
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['support']);
  });

  it('blocks a cached filing that differs from the submitted establishment', async () => {
    await processArratechOnboarding(log.id);
    events.length = 0;
    log.arratechOnboarding.filing.siret = '00000001800002';
    participantStatus = 'ACTIVE';
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['support']);
    expect(log.status).toBe('inReview');
  });
  it('uses the verification SIRET without a SIRET field on the company', async () => {
    await processArratechOnboarding(log.id);
    expect(events).toContain('approve');
    expect(company).not.toHaveProperty('siret');
  });

  it('blocks missing establishment data before any provider writes', async () => {
    delete log.countrySpecific;
    await processArratechOnboarding(log.id);
    expect(events).not.toContain('approve');
    expect(log.arratechOnboarding.phase).toBe('blocked');
  });

  it('accepts a reviewed legacy supplement without changing the signed snapshot', async () => {
    delete log.countrySpecific;
    log.arratechOnboarding.identitySupplement = {
      countrySpecific: { country: 'FR', siret: '30326504500011' }, source: 'customer-confirmation', reviewedBy: 'support',
      reviewedAt: new Date().toISOString(), verificationLogId: log.id,
    };
    await processArratechOnboarding(log.id);
    expect(events).toContain('approve');
    expect(log.countrySpecific).toBeUndefined();
  });

  it('rejects a supplement belonging to another session', async () => {
    delete log.countrySpecific;
    log.arratechOnboarding.identitySupplement = {
      countrySpecific: { country: 'FR', siret: '30326504500011' }, source: 'customer-confirmation', reviewedBy: 'support',
      reviewedAt: new Date().toISOString(), verificationLogId: 'other',
    };
    await processArratechOnboarding(log.id);
    expect(events).not.toContain('approve');
  });
  it('routes send-only to support once without registration or approval', async () => {
    delete log.countrySpecific;
    company.isSmpRecipient = false;
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['support']);
    expect(log.status).toBe('inReview');
    expect(log.errorMessage).toBeNull();
    expect(log.arratechOnboarding.phase).toBe('support');
    expect(log.arratechOnboarding.supportNotifiedAt).toBeDefined();
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['support']);
    expect(company.isSmpRecipient).toBe(false);
  });

  it('retries a failed send-only support notification without provider writes', async () => {
    company.isSmpRecipient = false;
    failSupport = true;
    await processArratechOnboarding(log.id);
    expect(log.arratechOnboarding.supportNotifiedAt).toBeUndefined();
    failSupport = false;
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['support', 'support']);
    expect(log.arratechOnboarding.supportNotifiedAt).toBeDefined();
  });

  it('keeps completion and audit when the success email fails', async () => {
    participantStatus = 'ACTIVE';
    failEmail = true;
    await processArratechOnboarding(log.id);
    expect(log.status).toBe('verified');
    expect(log.arratechOnboarding.phase).toBe('complete');
    expect(events.slice(-2)).toEqual(['audit', 'email']);
    await processArratechOnboarding(log.id);
    expect(events.filter((e) => e === 'email')).toHaveLength(1);
  });

  it('uses the same completion cleanup and audit for an admin rejection', async () => {
    await notifyVerificationCompletion(
      log.id,
      company,
      log.arratechOnboarding,
      'rejected',
      {} as any,
    );
    expect(log.arratechOnboarding.phase).toBe('complete');
    expect(events).toEqual(['audit', 'declined-email']);
  });
  it('approves then waits for ACTIVE before syncing or finalizing', async () => {
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['register', 'upload', 'approve']);
    expect(log.status).toBe('inReview');
    expect(log.arratechOnboarding.phase).toBe('activation');
    participantStatus = 'ACTIVE';
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['register', 'upload', 'approve', 'sync', 'finalize', 'audit', 'email']);
    expect(log.status).toBe('verified');
    await processArratechOnboarding(log.id);
    expect(events.filter((event) => event === 'email')).toHaveLength(1);
  });

  it('retries a capability synchronization failure without approving again', async () => {
    await processArratechOnboarding(log.id);
    participantStatus = 'ACTIVE';
    failSync = true;
    await processArratechOnboarding(log.id);
    expect(log.status).toBe('inReview');
    failSync = false;
    await processArratechOnboarding(log.id);
    expect(log.status).toBe('verified');
    expect(events.filter((event) => event === 'approve')).toHaveLength(1);
  });

  it('does no work when another worker owns the verification', async () => {
    acquired = false;
    await expect(processArratechOnboarding(log.id)).rejects.toThrow('already being processed');
    await expect(processArratechOnboarding(log.id)).rejects.toBeInstanceOf(VerificationBusyError);
    expect(events).toEqual([]);
  });

  it('keeps an assumed SIRET for manual review before any provider writes', async () => {
    mandateNotes = ['SIRET assumed'];
    await processArratechOnboarding(log.id);
    expect(log.arratechOnboarding.phase).toBe('blocked');
    expect(events).toEqual(['support']);
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['support']);
  });

  it('requires the actual mandate acceptance timestamp', async () => {
    log.mandateAcceptedAt = null;
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['support']);
    expect(log.errorMessage).toContain('signed mandate');
  });

  it('does not process test or non-French companies', async () => {
    team.useTestNetwork = true;
    await processArratechOnboarding(log.id);
    expect(events).toEqual(['support']);
  });

  it('does not act on a revoked verification', async () => {
    log.status = 'rejected';
    await processArratechOnboarding(log.id);
    expect(events).toEqual([]);
  });

  it('does not finalize active participants whose KYC is rejected', async () => {
    await processArratechOnboarding(log.id);
    kycStatus = 'REJECTED';
    participantStatus = 'ACTIVE';
    await processArratechOnboarding(log.id);
    expect(log.status).toBe('inReview');
    expect(events).not.toContain('finalize');
    expect(log.arratechOnboarding.phase).toBe('blocked');
  });
});
