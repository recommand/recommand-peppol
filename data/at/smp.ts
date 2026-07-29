import { canUpsertCompanyIdentifier, getCompanyIdentifiers, type CompanyIdentifier } from "@peppol/data/company-identifiers";
import { getCompanyDocumentTypes, type CompanyDocumentType } from "@peppol/data/company-document-types";
import { getCompanyById, type Company, type InsertCompany } from "@peppol/data/companies";
import { DOCUMENT_SCHEME, PROCESS_SCHEME } from "@peppol/data/phoss-smp/service-metadata";
import { UserFacingError } from "@peppol/utils/util";
import { fetchArratechJson, getArratechConfig } from "./client";

type MinimalCompanyIdentifier = {
  scheme: string;
  identifier: string;
};

type ArratechBusinessCard = {
  legalName: string;
  legalIdentifier?: string;
  legalIdentifierCode?: string;
  countryCode: string;
  taxIdentifier?: string;
  businessAddress: {
    streetAddress: string;
    postalCode: string;
    city: string;
    country: string;
  };
};

type ArratechSupportedDocumentType = {
  documentId: string;
  processId: string;
  exactMatchOnly?: boolean;
};

type ArratechParticipant = {
  id: string;
  name: string;
  participantIdentifier: string;
  environment?: "PROD" | "TEST";
  smpRef?: string;
  apRef?: string;
  supportedDocumentTypes?: ArratechSupportedDocumentType[] | null;
};

type ArratechDocumentType = {
  id: string;
  scheme?: string;
  value?: string;
  "document-type-id"?: string;
  "process-ids"?: Array<{
    scheme?: string;
    value?: string;
  }>;
};

const documentTypesCache = new Map<boolean, Promise<ArratechDocumentType[]>>();

function participantIdentifier(identifier: MinimalCompanyIdentifier): string {
  return `${identifier.scheme}:${identifier.identifier}`;
}

function documentTypeIdentifier(documentTypeCode: string): string {
  return `${DOCUMENT_SCHEME}::${documentTypeCode}`;
}

function processIdentifier(processId: string): string {
  return processId.includes("::") ? processId : `${PROCESS_SCHEME}::${processId}`;
}

function businessCard(company: Company | InsertCompany): ArratechBusinessCard {
  return {
    legalName: company.name,
    legalIdentifier: company.enterpriseNumber ?? undefined,
    legalIdentifierCode: company.enterpriseNumberScheme ?? undefined,
    countryCode: company.country,
    taxIdentifier: company.vatNumber ?? undefined,
    businessAddress: {
      streetAddress: company.address,
      postalCode: company.postalCode,
      city: company.city,
      country: company.country,
    },
  };
}

function arratechEnvironment(useTestNetwork: boolean): "PROD" | "TEST" {
  return useTestNetwork ? "TEST" : "PROD";
}

async function getArratechDocumentTypes(useTestNetwork: boolean): Promise<ArratechDocumentType[]> {
  if (!documentTypesCache.has(useTestNetwork)) {
    documentTypesCache.set(
      useTestNetwork,
      fetchArratechJson<{ items: ArratechDocumentType[] }>(
        "/document_types",
        {
          method: "GET",
          useTestNetwork,
        }
      ).then((result) => result.items)
    );
  }

  return documentTypesCache.get(useTestNetwork)!;
}

function getDocumentTypeValue(documentType: ArratechDocumentType): string | null {
  if (documentType["document-type-id"]) {
    return documentType["document-type-id"];
  }

  if (documentType.scheme && documentType.value) {
    return `${documentType.scheme}::${documentType.value}`;
  }

  return null;
}

function supportsProcess(documentType: ArratechDocumentType, processId: string): boolean {
  const processIds = documentType["process-ids"] ?? [];
  if (processIds.length === 0) {
    return true;
  }

  return processIds.some((process) => {
    if (!process.scheme || !process.value) {
      return false;
    }
    return `${process.scheme}::${process.value}` === processId;
  });
}

async function resolveArratechDocumentType(
  documentType: CompanyDocumentType,
  useTestNetwork: boolean
): Promise<ArratechSupportedDocumentType> {
  const docTypeId = documentTypeIdentifier(documentType.docTypeId);
  const processId = processIdentifier(documentType.processId);
  const documentTypes = await getArratechDocumentTypes(useTestNetwork);
  const matchingDocumentType = documentTypes.find((arratechDocumentType) => {
    return getDocumentTypeValue(arratechDocumentType) === docTypeId
      && supportsProcess(arratechDocumentType, processId);
  });

  const documentId = matchingDocumentType?.id;
  if (!documentId) {
    throw new UserFacingError(`Document type ${documentType.docTypeId} is not supported by Arratech SMP`);
  }

  return {
    documentId,
    processId,
  };
}

async function resolveArratechDocumentTypes(
  documentTypes: CompanyDocumentType[],
  useTestNetwork: boolean
): Promise<ArratechSupportedDocumentType[]> {
  const resolvedDocumentTypes = await Promise.all(
    documentTypes.map((documentType) => resolveArratechDocumentType(documentType, useTestNetwork))
  );

  if (resolvedDocumentTypes.length > 20) {
    throw new UserFacingError("AT SMP supports at most 20 document types per participant update");
  }

  return resolvedDocumentTypes;
}

export async function getParticipantByIdentifier({
  identifier,
  useTestNetwork,
}: {
  identifier: MinimalCompanyIdentifier;
  useTestNetwork: boolean;
}): Promise<ArratechParticipant | null> {
  const config = getArratechConfig(useTestNetwork);
  const peppolIdentifier = participantIdentifier(identifier);
  const searchParams = new URLSearchParams({
    search: peppolIdentifier,
    limit: "10",
  });
  searchParams.append("filter", `environment:eq:${arratechEnvironment(useTestNetwork)}`);
  searchParams.append("filter", `smpRef:eq:${config.smpRef}`);
  searchParams.append("filter", `apRef:eq:${config.apRef}`);

  const result = await fetchArratechJson<{ items: ArratechParticipant[] }>(
    `/orgs/${config.orgId}/participants?${searchParams.toString()}`,
    {
      method: "GET",
      useTestNetwork,
    }
  );

  return result.items.find((participant) => {
    return participant.participantIdentifier === peppolIdentifier
      && (!participant.environment || participant.environment === arratechEnvironment(useTestNetwork))
      && (!participant.smpRef || participant.smpRef === config.smpRef)
      && (!participant.apRef || participant.apRef === config.apRef);
  }) ?? null;
}

async function updateSupportedDocumentTypes({
  participantId,
  documentTypes,
  useTestNetwork,
}: {
  participantId: string;
  documentTypes: ArratechSupportedDocumentType[];
  useTestNetwork: boolean;
}): Promise<void> {
  const config = getArratechConfig(useTestNetwork);
  await fetchArratechJson<ArratechParticipant>(
    `/orgs/${config.orgId}/participants/${participantId}/supported_document_types`,
    {
      method: "PUT",
      body: JSON.stringify({ supportedDocumentTypes: documentTypes }),
      useTestNetwork,
    }
  );
}

async function publishParticipant({
  participantId,
  useTestNetwork,
}: {
  participantId: string;
  useTestNetwork: boolean;
}): Promise<void> {
  const config = getArratechConfig(useTestNetwork);
  await fetchArratechJson(
    `/orgs/${config.orgId}/participants/request-pd-publish`,
    {
      method: "POST",
      body: JSON.stringify({ ids: [participantId] }),
      useTestNetwork,
    }
  );
}

async function registerCompanyIdentifier({
  company,
  identifier,
  documentTypes,
  useTestNetwork,
}: {
  company: Company | InsertCompany;
  identifier: MinimalCompanyIdentifier;
  documentTypes: CompanyDocumentType[];
  useTestNetwork: boolean;
}) {
  if (!company.isSmpRecipient || !company.id) {
    return;
  }

  if (!await canUpsertCompanyIdentifier(identifier.scheme, identifier.identifier, undefined, company.id, company.id)) {
    throw new UserFacingError("Company cannot be registered as SMP recipient, it has identifiers that are already registered as recipient with another company.");
  }

  const config = getArratechConfig(useTestNetwork);
  const peppolIdentifier = participantIdentifier(identifier);
  const supportedDocumentTypes = await resolveArratechDocumentTypes(documentTypes, useTestNetwork);
  const existingParticipant = await getParticipantByIdentifier({
    identifier,
    useTestNetwork,
  });

  const participant = existingParticipant
    ? await fetchArratechJson<ArratechParticipant>(
      `/orgs/${config.orgId}/participants/${existingParticipant.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: company.name,
          businessCard: businessCard(company),
        }),
        useTestNetwork,
      }
    )
    : await fetchArratechJson<ArratechParticipant>(
      `/orgs/${config.orgId}/participants`,
      {
        method: "POST",
        body: JSON.stringify({
          name: company.name,
          participantIdentifier: peppolIdentifier,
          smpRef: config.smpRef,
          apRef: config.apRef,
          transportProfile: "peppol-transport-as4-v2_0",
          businessCard: businessCard(company),
        }),
        useTestNetwork,
      }
    );

  console.log("About to update supported document types", supportedDocumentTypes);

  await updateSupportedDocumentTypes({
    participantId: participant.id,
    documentTypes: supportedDocumentTypes,
    useTestNetwork,
  });
  await publishParticipant({ participantId: participant.id, useTestNetwork });
}

export async function upsertCompanyRegistrations({
  companyId,
  useTestNetwork,
}: {
  companyId: string;
  useTestNetwork: boolean;
}) {
  const company = await getCompanyById(companyId);
  if (company && !company.isSmpRecipient) {
    return;
  }

  const identifiers = await getCompanyIdentifiers(companyId);
  const documentTypes = await getCompanyDocumentTypes(companyId);
  if (!company || !identifiers || !documentTypes) {
    throw new UserFacingError("Company or identifiers or document types not found, could not upsert company registration");
  }

  for (const identifier of identifiers) {
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
  const company = await getCompanyById(companyId);
  const documentTypes = await getCompanyDocumentTypes(companyId);
  if (!company || !documentTypes) {
    throw new UserFacingError("Company or document types not found, could not upsert company registration");
  }

  await registerCompanyIdentifier({ company, identifier, documentTypes, useTestNetwork });
}

export async function unregisterCompanyRegistrations({
  companyId,
  useTestNetwork,
}: {
  companyId: string;
  useTestNetwork: boolean;
}) {
  const identifiers = await getCompanyIdentifiers(companyId);
  if (!identifiers) {
    throw new UserFacingError("Identifiers not found, could not unregister company registration");
  }

  for (const identifier of identifiers) {
    await unregisterCompanyIdentifier({ identifier, useTestNetwork });
  }
}

export async function unregisterCompanyDocumentType({
  documentType,
  useTestNetwork,
}: {
  documentType: CompanyDocumentType;
  useTestNetwork: boolean;
}) {
  const identifiers = await getCompanyIdentifiers(documentType.companyId);
  const documentTypeToRemove = await resolveArratechDocumentType(documentType, useTestNetwork);

  for (const identifier of identifiers) {
    const participant = await getParticipantByIdentifier({ identifier, useTestNetwork });
    if (!participant) {
      continue;
    }

    const currentDocumentTypes = await fetchArratechJson<ArratechSupportedDocumentType[]>(
      `/orgs/${getArratechConfig(useTestNetwork).orgId}/participants/${participant.id}/supported_document_types`,
      {
        method: "GET",
        useTestNetwork,
      }
    );
    const nextDocumentTypes = currentDocumentTypes.filter((currentDocumentType) => {
      return currentDocumentType.documentId !== documentTypeToRemove.documentId
        || currentDocumentType.processId !== documentTypeToRemove.processId;
    });

    await updateSupportedDocumentTypes({
      participantId: participant.id,
      documentTypes: nextDocumentTypes,
      useTestNetwork,
    });
  }
}

export async function unregisterCompanyIdentifier({
  identifier,
  useTestNetwork,
}: {
  identifier: CompanyIdentifier;
  useTestNetwork: boolean;
}) {
  const participant = await getParticipantByIdentifier({ identifier, useTestNetwork });
  if (!participant) {
    return;
  }

  const config = getArratechConfig(useTestNetwork);
  await fetchArratechJson(
    `/orgs/${config.orgId}/participants/batch-delete`,
    {
      method: "POST",
      body: JSON.stringify({ ids: [participant.id] }),
      useTestNetwork,
    }
  );
}
