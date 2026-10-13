import { UserFacingError } from "@peppol/utils/util";
import { getCompanyById, type Company } from "@peppol/data/companies";
import { getCompanyDocumentTypes, type CompanyDocumentType } from "@peppol/data/company-document-types";
import { canUpsertCompanyIdentifier, getCompanyIdentifiers } from "@peppol/data/company-identifiers";
import {
  ElmaApiError,
  getElmaClient,
  type ElmaClient,
  type ElmaContact,
  type ElmaParticipant,
  type ElmaParticipantForm,
} from "./client";
import { getElmaProcessCatalogue, mapDocumentTypesToElmaProcesses } from "./processes";

// ELMA as the SMP of a company. ELMA registers Norwegian organisation numbers (ICD
// 0192) only; the identifier policy keeps other schemes off companies on ELMA. The
// SML and the Peppol Directory are ELMA's business: nothing here touches them.

export const ELMA_ICD = "0192";

type MinimalCompanyIdentifier = { scheme: string; identifier: string };

export type PublishOutcome = "added" | "updated" | "transferred";

/** Whether ELMA refused an add because the participant is already registered. */
function isAlreadyRegistered(error: unknown): boolean {
  return error instanceof ElmaApiError && (error.status === 409 || (error.status === 400 && /exist/i.test(error.body)));
}

/** Whether ELMA refused an update because the participant is not ours to change. */
function isNotOurs(error: unknown): boolean {
  return error instanceof ElmaApiError && (error.status === 403 || error.status === 404);
}

/**
 * Whether ELMA names another service provider for the participant. ELMA does not
 * return the provider of a participant at all (unlike its API description says),
 * so a participant without one may be anyone's; a refused update tells.
 */
function namesOtherProvider(participant: ElmaParticipant, client: ElmaClient): boolean {
  return !!participant.provider?.identifier && participant.provider.identifier !== client.serviceProviderId;
}

/**
 * Makes ELMA publish the participant for the given processes under our service
 * provider: adds it when ELMA does not know it, updates it when it is ours, and
 * takes it over with ELMA's transfer between service providers when another
 * provider registered it. The processes replace whatever the participant had.
 */
export async function publishParticipant({
  client,
  organisationNumber,
  name,
  form,
}: {
  client: ElmaClient;
  organisationNumber: string;
  name: string;
  form: ElmaParticipantForm;
}): Promise<PublishOutcome> {
  const existing = await client.getParticipant(ELMA_ICD, organisationNumber);
  if (!existing) {
    try {
      await client.addParticipant(ELMA_ICD, organisationNumber, name, form);
      return "added";
    } catch (error) {
      // Another service provider's participant may not be visible to us; ELMA then
      // only says so when we try to add it.
      if (!isAlreadyRegistered(error)) {
        throw error;
      }
    }
  } else if (!namesOtherProvider(existing, client)) {
    try {
      await client.updateParticipant(ELMA_ICD, organisationNumber, form);
      return "updated";
    } catch (error) {
      if (!isNotOurs(error)) {
        throw error;
      }
    }
  }

  try {
    await client.transferParticipant(ELMA_ICD, organisationNumber, client.serviceProviderId);
  } catch (error) {
    if (error instanceof ElmaApiError) {
      console.error(`ELMA refused to transfer ${ELMA_ICD}:${organisationNumber} to us`, error);
      const owner = existing?.provider?.title ? ` (${existing.provider.title})` : "";
      throw new UserFacingError(
        `${ELMA_ICD}:${organisationNumber} is already registered in ELMA, the Norwegian receiver register, by another service provider${owner}, and ELMA did not let us take it over. Ask that provider to transfer it to Recommand in ELMA, or contact support@recommand.eu.`
      );
    }
    throw error;
  }
  await client.updateParticipant(ELMA_ICD, organisationNumber, form);
  return "transferred";
}

/** The contact ELMA keeps for the participant: the company itself. */
export function contactFor(company: Pick<Company, "name" | "email" | "phone">): ElmaContact {
  return {
    name: company.name,
    ...(company.email ? { email: company.email } : {}),
    ...(company.phone ? { phoneNumber: company.phone } : {}),
  };
}

async function formFor(
  client: ElmaClient,
  company: Company,
  documentTypes: readonly CompanyDocumentType[],
  useTestNetwork: boolean
): Promise<ElmaParticipantForm> {
  const catalogue = await getElmaProcessCatalogue(client, useTestNetwork);
  return {
    processes: mapDocumentTypesToElmaProcesses(documentTypes, catalogue).map((identifier) => ({ identifier })),
    contact: contactFor(company),
  };
}

function assertElmaIdentifier(identifier: MinimalCompanyIdentifier): void {
  if (identifier.scheme !== ELMA_ICD) {
    throw new UserFacingError(
      `ELMA, the Norwegian receiver register, only registers Norwegian organisation numbers (scheme ${ELMA_ICD}). ${identifier.scheme}:${identifier.identifier} cannot be registered there.`
    );
  }
}

async function registerCompanyIdentifier({
  company,
  identifier,
  documentTypes,
  useTestNetwork,
}: {
  company: Company;
  identifier: MinimalCompanyIdentifier;
  documentTypes: CompanyDocumentType[];
  useTestNetwork: boolean;
}): Promise<void> {
  if (!company.isSmpRecipient) {
    return;
  }
  assertElmaIdentifier(identifier);
  if (!(await canUpsertCompanyIdentifier(identifier.scheme, identifier.identifier, undefined, company.id, company.id))) {
    throw new UserFacingError("Company cannot be registered as SMP recipient, it has identifiers that are already registered as recipient with another company.");
  }
  const client = getElmaClient(useTestNetwork);
  await publishParticipant({
    client,
    organisationNumber: identifier.identifier,
    name: company.name,
    form: await formFor(client, company, documentTypes, useTestNetwork),
  });
}

async function loadCompany(companyId: string): Promise<{ company: Company; documentTypes: CompanyDocumentType[] }> {
  const company = await getCompanyById(companyId);
  if (!company) {
    throw new UserFacingError("Company not found, could not upsert company registration");
  }
  return { company, documentTypes: await getCompanyDocumentTypes(companyId) };
}

export async function upsertCompanyRegistrations({ companyId, useTestNetwork }: { companyId: string; useTestNetwork: boolean }) {
  const { company, documentTypes } = await loadCompany(companyId);
  if (!company.isSmpRecipient) {
    return;
  }
  for (const identifier of await getCompanyIdentifiers(companyId)) {
    await registerCompanyIdentifier({ company, identifier, documentTypes, useTestNetwork });
  }
}

export async function upsertCompanyRegistration({
  companyId,
  identifier,
  useTestNetwork,
}: {
  companyId: string;
  identifier: MinimalCompanyIdentifier;
  useTestNetwork: boolean;
}) {
  const { company, documentTypes } = await loadCompany(companyId);
  await registerCompanyIdentifier({ company, identifier, documentTypes, useTestNetwork });
}

export async function unregisterCompanyIdentifier({
  identifier,
  useTestNetwork,
}: {
  identifier: MinimalCompanyIdentifier;
  useTestNetwork: boolean;
}) {
  if (identifier.scheme !== ELMA_ICD) {
    return;
  }
  await getElmaClient(useTestNetwork).deleteParticipant(ELMA_ICD, identifier.identifier);
}

export async function unregisterCompanyRegistrations({ companyId, useTestNetwork }: { companyId: string; useTestNetwork: boolean }) {
  for (const identifier of await getCompanyIdentifiers(companyId)) {
    await unregisterCompanyIdentifier({ identifier, useTestNetwork });
  }
}

/**
 * Publishes the company's processes without the given document type. A process
 * that another remaining document type still maps to stays: ELMA cannot publish
 * part of a process.
 */
export async function unregisterCompanyDocumentType({
  documentType,
  useTestNetwork,
}: {
  documentType: CompanyDocumentType;
  useTestNetwork: boolean;
}) {
  const { company, documentTypes } = await loadCompany(documentType.companyId);
  const remaining = documentTypes.filter((candidate) => candidate.id !== documentType.id);
  const client = getElmaClient(useTestNetwork);
  const form = await formFor(client, company, remaining, useTestNetwork);
  for (const identifier of await getCompanyIdentifiers(documentType.companyId)) {
    if (identifier.scheme !== ELMA_ICD) {
      continue;
    }
    const participant = await client.getParticipant(ELMA_ICD, identifier.identifier);
    if (!participant || namesOtherProvider(participant, client)) {
      continue;
    }
    try {
      await client.updateParticipant(ELMA_ICD, identifier.identifier, form);
    } catch (error) {
      // Another provider's participant is theirs to change.
      if (!isNotOurs(error)) {
        throw error;
      }
    }
  }
}
