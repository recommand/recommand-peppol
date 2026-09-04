import { describe, expect, it } from 'bun:test';
import {
  ensureApprovedKyc,
  KycOnboardingError,
  type KycRecord,
} from '../data/at/kyc-onboarding-client';

const mandate = Buffer.from('%PDF-1.7 signed mandate');
const path = '/orgs/org/participants/participant/kyc';
const input = {
  path,
  siren: '830905253',
  siret: '83090525300015',
  mandate,
  fileName: 'mandate.pdf',
};

function server(initial: Partial<KycRecord> = {}, missing = false) {
  const calls: string[] = [];
  const kyc: KycRecord = {
    status: 'PENDING',
    jurisdiction: 'FR',
    metaData: { siren: input.siren, siret: input.siret },
    documents: [],
    ...initial,
  };
  let exists = !missing;
  let failAfterUpload = false;
  let failAfterApprove = false;
  const documents = new Map<string, Buffer>();
  const request = async (url: string, options: RequestInit) => {
    const call = `${options.method} ${url}`;
    calls.push(call);
    if (url === path && options.method === 'GET')
      return exists ? Response.json(kyc) : Response.json({ code: 'AT-7001' }, { status: 404 });
    if (url === path && options.method === 'POST') {
      exists = true;
      return Response.json(kyc, { status: 201 });
    }
    if (url === `${path}/documents` && options.method === 'POST') {
      const file = (options.body as FormData).get('file') as File;
      expect(file.type).toBe('application/pdf');
      documents.set('mandate', Buffer.from(await file.arrayBuffer()));
      kyc.documents.push('mandate');
      if (failAfterUpload) {
        failAfterUpload = false;
        throw new Error('Connection lost after upload');
      }
      return Response.json({ docId: 'mandate' }, { status: 201 });
    }
    if (url === `${path}/approve`) {
      expect(kyc.documents.length).toBeGreaterThan(0);
      kyc.status = 'APPROVED';
      if (failAfterApprove) {
        failAfterApprove = false;
        throw new Error('Connection lost after approval');
      }
      return Response.json(kyc);
    }
    const docId = url.split('/').at(-1)!;
    if (documents.has(docId)) return new Response(new Uint8Array(documents.get(docId)!));
    throw new Error(`Unexpected request ${call}`);
  };
  return {
    request,
    calls,
    kyc,
    documents,
    failUpload: () => {
      failAfterUpload = true;
    },
    failApprove: () => {
      failAfterApprove = true;
    },
  };
}

describe('Arratech KYC onboarding', () => {
  it('uploads and approves an automatically created KYC without creating it again', async () => {
    const api = server();
    await ensureApprovedKyc({ ...input, request: api.request });
    expect(api.calls).toEqual([
      `GET ${path}`,
      `POST ${path}/documents`,
      `POST ${path}/approve`,
      `GET ${path}`,
    ]);
  });

  it('opens a missing legacy KYC before uploading', async () => {
    const api = server({}, true);
    await ensureApprovedKyc({ ...input, request: api.request });
    expect(api.calls.slice(0, 3)).toEqual([`GET ${path}`, `POST ${path}`, `GET ${path}`]);
    expect(api.kyc.status).toBe('APPROVED');
  });

  it('recovers a lost upload response by matching the actual mandate bytes', async () => {
    const api = server();
    api.failUpload();
    await expect(ensureApprovedKyc({ ...input, request: api.request })).rejects.toThrow(
      'Connection lost',
    );
    await ensureApprovedKyc({ ...input, request: api.request });
    expect(api.calls.filter((call) => call === `POST ${path}/documents`)).toHaveLength(1);
    expect(api.kyc.status).toBe('APPROVED');
  });

  it('does not mistake another attached document for the signed mandate', async () => {
    const api = server({ documents: ['other'] });
    api.documents.set('other', Buffer.from('some other document'));
    await ensureApprovedKyc({ ...input, request: api.request });
    expect(api.calls).toContain(`POST ${path}/documents`);
  });

  it('recovers a lost approval response without a second approval', async () => {
    const api = server();
    api.failApprove();
    await expect(ensureApprovedKyc({ ...input, request: api.request })).rejects.toThrow(
      'Connection lost',
    );
    await ensureApprovedKyc({ ...input, request: api.request });
    expect(api.calls.filter((call) => call === `POST ${path}/approve`)).toHaveLength(1);
  });

  it('does not approve mismatching metadata', async () => {
    const api = server({ metaData: { siren: 'wrong', siret: input.siret } });
    await expect(ensureApprovedKyc({ ...input, request: api.request })).rejects.toThrow(
      'does not match',
    );
    expect(api.calls).toEqual([`GET ${path}`]);
  });

  it('leaves rejected KYC for review', async () => {
    const api = server({ status: 'REJECTED', rejectionReason: 'Invalid mandate' });
    await expect(ensureApprovedKyc({ ...input, request: api.request })).rejects.toThrow(
      'Invalid mandate',
    );
    expect(api.calls).toHaveLength(1);
  });

  it('handles a concurrent approval conflict by re-reading the record', async () => {
    const api = server();
    const request = async (url: string, options: RequestInit) => {
      if (url.endsWith('/approve')) {
        api.kyc.status = 'APPROVED';
        return Response.json({ code: 'AT-7016' }, { status: 409 });
      }
      return api.request(url, options);
    };
    await ensureApprovedKyc({ ...input, request });
    expect(api.kyc.status).toBe('APPROVED');
  });

  it('does not create KYC when the participant itself is missing', async () => {
    const calls: string[] = [];
    await expect(
      ensureApprovedKyc({
        ...input,
        request: async (_url, options) => {
          calls.push(options.method!);
          return Response.json({ code: 'AT-1057' }, { status: 404 });
        },
      }),
    ).rejects.toBeInstanceOf(KycOnboardingError);
    expect(calls).toEqual(['GET']);
  });
});
