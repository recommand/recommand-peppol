import { findCompanyByPeppolId, type Company } from "@peppol/data/companies";
import { getCompanyDocumentTypes } from "@peppol/data/company-document-types";
import { DOCUMENT_SCHEME } from "@peppol/data/phoss-smp/service-metadata";
import { normalizeProcessId } from "@peppol/utils/parsing/process-id";

/**
 * A playground that is not connected to the Peppol Test Network answers every recipient
 * question the way production would, and only leaves out the delivery. Its own
 * companies are laid over the production network: an address that belongs to one of
 * them is answered from that company's registrations, any other address from the
 * production SMP. Sending, generating and both verify endpoints share this lookup, so
 * they cannot disagree about a recipient.
 */
export function isSimulatedPlayground(team: {
  isPlayground?: boolean | null;
  useTestNetwork?: boolean | null;
}): boolean {
  return (team.isPlayground ?? false) && !(team.useTestNetwork ?? false);
}

/**
 * Addresses a simulated playground reserves for a participant the network does not
 * know, so failure handling can be tested without looking anything up.
 */
const RESERVED_UNKNOWN_RECIPIENTS = ["404:404", "0208:1234567894"];

export function isReservedUnknownRecipient(recipientAddress: string): boolean {
  return RESERVED_UNKNOWN_RECIPIENTS.includes(recipientAddress.toLowerCase());
}

export type PlaygroundRegistration = { docTypeId: string; processId: string };

export type PlaygroundRecipient = {
  company: Company;
  /**
   * What the company receives, with the identifier schemes left off, which is how the
   * document format registry and the SMP lookups write them. Registrations may be
   * stored with or without their scheme, as the API accepts both.
   */
  registrations: PlaygroundRegistration[];
};

/**
 * The company in this playground team the address belongs to, when that company is set
 * up to receive. Read fresh on every call: a registration added in the playground has
 * to count for the next request, and the lookup is a database read, not a network one.
 */
export async function findPlaygroundRecipient(options: {
  recipientAddress: string;
  playgroundTeamId: string;
}): Promise<PlaygroundRecipient | null> {
  const company = await findCompanyByPeppolId({
    peppolId: options.recipientAddress,
    playgroundTeamId: options.playgroundTeamId,
  });
  if (!company) return null;

  const registrations = await getCompanyDocumentTypes(company.id);
  return {
    company,
    registrations: registrations.map((registration) => ({
      docTypeId: normalizeDocTypeId(registration.docTypeId),
      processId: normalizeProcessId(registration.processId),
    })),
  };
}

export function normalizeDocTypeId(docTypeId: string): string {
  const prefix = `${DOCUMENT_SCHEME}::`;
  return docTypeId.startsWith(prefix) ? docTypeId.slice(prefix.length) : docTypeId;
}

/**
 * Whether the recipient is registered for the document type, and, when one is given,
 * under that process.
 */
export function playgroundRecipientAccepts(
  recipient: PlaygroundRecipient,
  docTypeId: string,
  processId?: string,
): boolean {
  const wantedDocTypeId = normalizeDocTypeId(docTypeId);
  const wantedProcessId = processId ? normalizeProcessId(processId) : undefined;
  return recipient.registrations.some(
    (registration) =>
      registration.docTypeId === wantedDocTypeId &&
      (wantedProcessId === undefined || registration.processId === wantedProcessId),
  );
}
