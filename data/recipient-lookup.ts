import { isSimulatedPlayground, resolvePlaygroundAddress } from "@peppol/data/playground/recipients";
import { fetchBusinessCard, fetchServiceMetadata, verifyRecipient } from "@peppol/data/recipient";
import { getTeamExtension } from "@peppol/data/teams";
import { getDocumentTypeName } from "@peppol/utils/document-type-lookup";

export type RecipientLookupOptions = {
  includeBusinessCard?: boolean;
  includeEndpointDetails?: boolean;
  peppolAddress: string;
};

/**
 * What the participant behind a Peppol address is registered to receive, as a
 * team sees it: answered from the same place a send of the team would be routed
 * from. A lookup that fails, including for an address that isn't registered at
 * all, gives `{ isValid: false }`.
 */
export const lookUpRecipient = async (
  teamId: string,
  { includeBusinessCard, includeEndpointDetails, peppolAddress }: RecipientLookupOptions
): Promise<Record<string, unknown>> => {
  try {
    const teamExtension = await getTeamExtension(teamId);
    const useTestNetwork = teamExtension?.useTestNetwork ?? false;

    if (teamExtension && isSimulatedPlayground(teamExtension)) {
      const playgroundAddress = await resolvePlaygroundAddress({ playgroundTeamId: teamId, recipientAddress: peppolAddress });
      if (playgroundAddress?.kind === "unknown") {
        return { isValid: false };
      }

      if (playgroundAddress?.kind === "company") {
        const playgroundRecipient = playgroundAddress.recipient;
        const docTypeIds = [...new Set(playgroundRecipient.registrations.map((registration) => registration.docTypeId))];

        return {
          isValid: true,
          supportedDocuments: docTypeIds.map((docTypeId) => ({ docTypeId, name: getDocumentTypeName(docTypeId) })),
          ...(includeBusinessCard
            ? {
                companyName: playgroundRecipient.company.name,
                countryCode: playgroundRecipient.company.country,
              }
            : {}),
        };
      }
    }

    const data = await verifyRecipient({ recipientAddress: peppolAddress, useTestNetwork });

    const supportedDocuments = includeEndpointDetails
      ? await Promise.all(
          data.supportedDocuments.map(async (doc) => {
            const ref = data.serviceMetadataReferences.find(
              (r) => r.includes(encodeURIComponent(doc.docTypeId)) || r.includes(doc.docTypeId)
            );
            if (!ref) {
              return doc;
            }

            // Endpoint details are extra: an SMP that does not give them leaves the document listed without.
            const details = await fetchServiceMetadata(ref).catch(() => null);

            return { ...doc, ...details };
          })
        )
      : data.supportedDocuments;

    const businessCard = includeBusinessCard
      ? await fetchBusinessCard({ participantId: peppolAddress, smpUrl: data.smpUrl })
      : null;

    return {
      isValid: true,
      serviceMetadataReferences: data.serviceMetadataReferences,
      smpHostnames: data.smpHostnames,
      smpUrl: data.smpUrl,
      supportedDocuments,
      ...businessCard,
    };
  } catch {
    return { isValid: false };
  }
};
