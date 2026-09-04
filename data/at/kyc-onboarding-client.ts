import { createHash } from 'node:crypto';

export type KycRecord = {
  status: string;
  jurisdiction: string;
  metaData: { siren?: string; siret?: string };
  documents: string[];
  rejectionReason?: string;
};

export class KycOnboardingError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

type Request = (path: string, options: RequestInit) => Promise<Response>;

export async function readKycResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new KycOnboardingError(
      `Arratech HTTP ${response.status}: ${message}`,
      response.status >= 500 || response.status === 429 || response.status === 408,
    );
  }
  return response.json() as Promise<T>;
}

export async function ensureApprovedKyc({
  request,
  path,
  siren,
  siret,
  mandate,
  fileName,
}: {
  request: Request;
  path: string;
  siren: string;
  siret: string;
  mandate: Buffer;
  fileName: string;
}): Promise<void> {
  let response = await request(path, { method: 'GET' });
  if (response.status === 404) {
    const error = (await response.clone().json()) as { code?: string };
    if (error.code !== 'AT-7001') await readKycResponse(response);
    const created = await request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jurisdiction: 'FR', metaData: { siren, siret } }),
    });
    if (created.status !== 409) await readKycResponse(created);
    response = await request(path, { method: 'GET' });
  }
  const kyc = await readKycResponse<KycRecord>(response);
  if (kyc.jurisdiction !== 'FR' || kyc.metaData?.siren !== siren || kyc.metaData?.siret !== siret) {
    throw new KycOnboardingError(
      'KYC identity does not match the signed mandate; review the SIREN and SIRET.',
    );
  }
  if (kyc.status === 'APPROVED') return;
  if (kyc.status !== 'PENDING') {
    throw new KycOnboardingError(
      `KYC is ${kyc.status}: ${kyc.rejectionReason ?? 'manual review required'}`,
    );
  }
  const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const mandateHash = hash(mandate);
  let uploaded = false;
  for (const docId of kyc.documents ?? []) {
    const document = await request(`${path}/documents/${encodeURIComponent(docId)}`, {
      method: 'GET',
    });
    if (!document.ok) await readKycResponse(document);
    if (hash(Buffer.from(await document.arrayBuffer())) === mandateHash) {
      uploaded = true;
      break;
    }
  }
  if (!uploaded) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(mandate)], { type: 'application/pdf' }), fileName);
    await readKycResponse(await request(`${path}/documents`, { method: 'POST', body: form }));
  }
  const approval = await request(`${path}/approve`, { method: 'POST' });
  if (approval.status !== 409) await readKycResponse(approval);
  const verified = await readKycResponse<KycRecord>(await request(path, { method: 'GET' }));
  if (verified.status !== 'APPROVED') {
    throw new KycOnboardingError(
      `KYC approval not confirmed (${verified.status})`,
      verified.status === 'PENDING',
    );
  }
}
