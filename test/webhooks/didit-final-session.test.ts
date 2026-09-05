import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';

let status = 'rejected';
let locked = false;
let lockFails = false;
let requiresKyc = true;
class BusyError extends Error {}
const events: string[] = [];
const secret = crypto.randomUUID();
mock.module('@recommand/lib/api', () => ({ Server: Hono }));
mock.module('@recommand/lib/utils', () => ({ actionSuccess: (value: unknown) => value, actionFailure: (value: unknown) => ({error: String(value)}) }));
mock.module('@directory/utils/util', () => ({ UserFacingError: class extends Error {} }));
mock.module('@peppol/db/schema', () => ({companyVerificationLog: {id:'id'}}));
mock.module('@recommand/db', () => ({db: {update: () => { events.push('update'); return {set: () => ({where: async () => {}})}; }}}));
mock.module('@peppol/data/company-verification', () => ({
  getCompanyVerificationLog: async () => { expect(locked).toBe(true); return {id:'session', status, companyId:'company', firstName:'Example', lastName:'Signer'}; },
  isFinalVerificationStatus: (value: string) => ['verified','rejected','error'].includes(value),
  finalizeCompanyVerification: async (input: {status: string}) => {events.push(`finalize:${input.status}`); return {status:input.status};},
}));
mock.module('@peppol/data/verification-lock', () => ({ VerificationBusyError: BusyError, withVerificationLock: async (_id: string, action: () => Promise<unknown>) => {
  if (lockFails) throw new BusyError('busy');
  locked = true; try {return await action();} finally {locked = false;}
}}));
mock.module('@peppol/data/at/kyc', () => ({requiresArratechKycReview: async () => requiresKyc}));
mock.module('@peppol/data/at/kyc-review', () => ({startArratechKycReview: async () => { events.push('kyc'); return {status:'inReview'}; }}));
mock.module('@peppol/data/companies', () => ({getCompanyById: async () => { events.push('company'); return {id:'company',teamId:'team',name:'Example'}; }}));
mock.module('@peppol/data/send-manual-verification-email', () => ({
  sendManualVerificationEmail: async () => {events.push('email');},
  sendManualVerificationDeclinedEmail: async () => {events.push('email');},
}));
const {default: server} = await import('../../api/internal/didit-webhook');
beforeEach(() => {status = 'rejected'; locked = false; lockFails = false; requiresKyc = true; events.length = 0;});
async function send(providerStatus: string, manual = false) {
  const body = JSON.stringify({session_id:'identity-session',vendor_data:'session',webhook_type:'status.updated',status:providerStatus,
    decision: {id_verification:{first_name:'Example',last_name:'Signer'}, ...(manual ? {reviews:[{new_status:providerStatus}]} : {})}});
  const previous = process.env.DIDIT_WEBHOOK_SECRET_KEY;
  process.env.DIDIT_WEBHOOK_SECRET_KEY = secret;
  try {
    return await server.request('/didit', {method:'POST',body,headers:{
      'X-Timestamp': String(Math.floor(Date.now()/1000)), 'X-Signature':createHmac('sha256',secret).update(body).digest('hex'),
    }});
  } finally {
    if (previous === undefined) delete process.env.DIDIT_WEBHOOK_SECRET_KEY;
    else process.env.DIDIT_WEBHOOK_SECRET_KEY = previous;
  }
}
describe('late identity callbacks', () => {
  it('does not reopen finalized sessions or send notifications, including manual decisions', async () => {
    for (const final of ['rejected','verified','error']) {
      status = final;
      for (const provider of ['In Review','Approved','Declined']) {
        for (const manual of [false,true]) expect((await send(provider,manual)).status).toBe(200);
      }
    }
    expect(events).toEqual([]);
  });
  it('retains ordinary review and approved onboarding for non-final sessions', async () => {
    status = 'idVerificationRequested';
    expect((await send('In Review')).status).toBe(200);
    expect(events).toEqual(['update']); events.length = 0;
    expect((await send('Approved')).status).toBe(200);
    expect(events).toEqual(['company','kyc']);
  });
  it('does no work while a restart owns the session lock', async () => {
    lockFails = true;
    expect((await send('Approved')).status).toBe(503);
    expect(events).toEqual([]);
  });
  it('preserves ordinary approvals and rejections outside the Arratech flow', async () => {
    requiresKyc = false;
    status = 'idVerificationRequested';
    expect((await send('Approved')).status).toBe(200);
    expect(events).toEqual(['company','finalize:verified']);
    events.length = 0;
    expect((await send('Declined')).status).toBe(200);
    expect(events).toEqual(['company','finalize:rejected']);
  });
  it('preserves manual decision notifications for open non-Arratech sessions', async () => {
    requiresKyc = false;
    status = 'inReview';
    for (const [decision, result] of [['Approved','verified'],['Declined','rejected']]) {
      events.length = 0;
      expect((await send(decision!,true)).status).toBe(200);
      expect(events).toEqual(['company',`finalize:${result}`,'email']);
    }
  });
});
