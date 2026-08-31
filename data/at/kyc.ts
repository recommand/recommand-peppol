import { getCompanyIdentifiers } from "@peppol/data/company-identifiers";
import type { Company } from "@peppol/data/companies";
import { getTeamExtension } from "@peppol/data/teams";
import { UserFacingError } from "@directory/utils/util";
import { fetchArratech, fetchArratechJson, getArratechConfig } from "./client";
import { getParticipantByIdentifier } from "./smp";
import {
  getMandateDocument,
  renderMandatePdf,
  resolveCompanyKycIdentity,
  type CompanyKycIdentity,
  type MandateInput,
} from "./mandate";

/**
 * Companies on the Arratech SMP are only verified once Arratech accepts their
 * KYC, and that KYC is filed with a mandate the representative signs. Playground
 * teams never reach Arratech, so they neither sign nor get filed.
 */
export async function requiresArratechKycReview(company: Company): Promise<boolean> {
  if (company.smpProvider !== "at-shared-smp-fr") {
    return false;
  }

  const teamExtension = await getTeamExtension(company.teamId);
  return !(teamExtension?.isPlayground ?? false);
}

/**
 * Assembles the mandate for a company. A null proof reference renders the draft
 * the signatory reads before their identity verification signs it.
 */
export async function buildMandateInput({
  company,
  signatory,
  signedAt,
  proofReference,
  reference,
}: {
  company: Company;
  signatory: { firstName: string; lastName: string; role?: string };
  signedAt: Date;
  proofReference: string | null;
  reference: string;
}): Promise<MandateInput> {
  const identifiers = await getCompanyIdentifiers(company.id);
  if (identifiers.length === 0) {
    throw new UserFacingError(
      "Company has no identifiers, cannot submit KYC to Arratech",
    );
  }

  return {
    reference,
    company,
    identifiers,
    identity: resolveCompanyKycIdentity(company, identifiers),
    signatory: {
      firstName: signatory.firstName,
      lastName: signatory.lastName,
      role:
        signatory.role ?? getMandateDocument(company.country).defaultSignatoryRole,
    },
    signedAt,
    proofReference,
  };
}

async function submitParticipantKyc({
  participantId,
  jurisdiction,
  metaData,
  useTestNetwork,
}: {
  participantId: string;
  jurisdiction: string;
  // France is the only jurisdiction whose KYC metadata Arratech has defined for
  // us; companies from other countries are filed on their document alone.
  metaData?: Record<string, string>;
  useTestNetwork: boolean;
}): Promise<void> {
  const config = getArratechConfig(useTestNetwork);
  await fetchArratechJson(
    `/orgs/${config.orgId}/participants/${participantId}/kyc`,
    {
      method: "POST",
      body: JSON.stringify({
        jurisdiction,
        ...(metaData ? { metaData } : {}),
      }),
      useTestNetwork,
    },
  );
}

async function uploadParticipantKycDocument({
  participantId,
  document,
  fileName,
  useTestNetwork,
}: {
  participantId: string;
  document: Buffer;
  fileName: string;
  useTestNetwork: boolean;
}): Promise<void> {
  const config = getArratechConfig(useTestNetwork);
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(document)], { type: "application/pdf" }),
    fileName,
  );

  const response = await fetchArratech(
    `/orgs/${config.orgId}/participants/${participantId}/kyc/documents`,
    {
      method: "POST",
      body: formData,
      useTestNetwork,
    },
  );

  if (!response.ok) {
    throw new UserFacingError(
      `KYC document upload failed (${response.status}): ${await response.text()}`,
    );
  }
}

export type ArratechKycFiling = {
  jurisdiction: string;
  identity: CompanyKycIdentity;
  electronicAddresses: string[];
  signatoryName: string;
  mandate: Buffer;
  mandateFileName: string;
};

/**
 * Assembles what Arratech needs to KYC a company: how it is identified in its
 * country and the mandate signed by the representative whose identity we
 * verified.
 */
export async function buildArratechKycFiling({
  company,
  signatory,
  signedAt,
  proofReference,
  reference,
}: {
  company: Company;
  signatory: { firstName: string; lastName: string; role?: string };
  signedAt: Date;
  proofReference: string;
  reference: string;
}): Promise<ArratechKycFiling> {
  const input = await buildMandateInput({
    company,
    signatory,
    signedAt,
    proofReference,
    reference,
  });
  const { identity, identifiers } = input;

  const mandate = await renderMandatePdf(input);

  return {
    jurisdiction: company.country,
    identity,
    electronicAddresses: identifiers.map(
      (identifier) => `${identifier.scheme}:${identifier.identifier}`,
    ),
    signatoryName: `${signatory.firstName} ${signatory.lastName}`.trim(),
    mandate,
    mandateFileName: `mandate-${reference}.pdf`,
  };
}

/**
 * Files the KYC and its mandate against every Arratech participant of the
 * company. Arratech reviews it before the participant can operate.
 */
export async function submitArratechCompanyKyc({
  companyId,
  filing,
  useTestNetwork,
}: {
  companyId: string;
  filing: ArratechKycFiling;
  useTestNetwork: boolean;
}): Promise<void> {
  const identifiers = await getCompanyIdentifiers(companyId);

  for (const identifier of identifiers) {
    const participant = await getParticipantByIdentifier({
      identifier,
      useTestNetwork,
    });
    if (!participant) {
      throw new UserFacingError(
        `No Arratech participant found for ${identifier.scheme}:${identifier.identifier}`,
      );
    }

    await submitParticipantKyc({
      participantId: participant.id,
      jurisdiction: filing.jurisdiction,
      metaData: filing.identity.metaData,
      useTestNetwork,
    });
    await uploadParticipantKycDocument({
      participantId: participant.id,
      document: filing.mandate,
      fileName: filing.mandateFileName,
      useTestNetwork,
    });
  }
}
