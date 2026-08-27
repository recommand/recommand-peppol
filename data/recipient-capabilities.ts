import { getCompanyByPeppolId } from "@peppol/data/companies";
import { getCompanyDocumentTypes } from "@peppol/data/company-document-types";
import {
  docTypeIdFromServiceMetadataRef,
  fetchServiceProcessIds,
  verifyRecipient,
} from "@peppol/data/recipient";

/**
 * What a recipient can receive, as far as the network we are sending over knows it.
 *
 * The document types are known up front: production and the test network list them in
 * the participant's service group, a playground in the registrations of the company the
 * address belongs to. The processes behind one document type cost an extra request on
 * the real networks, so they are fetched only for the document types actually
 * considered, and remembered for the rest of the lookup's life.
 */
export type RecipientCapabilities = {
  supportsDocType(docTypeId: string): boolean;
  getProcessIds(docTypeId: string): Promise<string[]>;
};

/** How long a looked-up participant stays usable, so a batch of sends pays for one lookup. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

const cache = new Map<string, { expiresAt: number; capabilities: RecipientCapabilities }>();

function cacheKey(options: {
  recipientAddress: string;
  isPlayground: boolean;
  useTestNetwork: boolean;
  teamId: string;
}): string {
  const network = options.isPlayground && !options.useTestNetwork
    ? `playground:${options.teamId}`
    : options.useTestNetwork
      ? "test"
      : "production";
  return `${network}:${options.recipientAddress.toLowerCase()}`;
}

function readCache(key: string): RecipientCapabilities | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.capabilities;
}

function writeCache(key: string, capabilities: RecipientCapabilities): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [cachedKey, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(cachedKey);
    }
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, capabilities });
}

/**
 * The registrations a playground company holds, which is what a playground has in place
 * of an SMP: documents are handed straight to the receiving pipeline, and only a company
 * registered in this playground team ever receives one.
 */
async function getPlaygroundCapabilities(options: {
  recipientAddress: string;
  playgroundTeamId: string;
}): Promise<RecipientCapabilities> {
  const company = await getCompanyByPeppolId({
    peppolId: options.recipientAddress,
    playgroundTeamId: options.playgroundTeamId,
  });
  const registrations = await getCompanyDocumentTypes(company.id);

  const processIdsByDocType = new Map<string, string[]>();
  for (const registration of registrations) {
    const processIds = processIdsByDocType.get(registration.docTypeId) ?? [];
    processIds.push(registration.processId);
    processIdsByDocType.set(registration.docTypeId, processIds);
  }

  return {
    supportsDocType: (docTypeId) => processIdsByDocType.has(docTypeId),
    getProcessIds: async (docTypeId) => processIdsByDocType.get(docTypeId) ?? [],
  };
}

/** What the participant's SMP advertises, on the production or the test network. */
async function getSmpCapabilities(options: {
  recipientAddress: string;
  useTestNetwork: boolean;
}): Promise<RecipientCapabilities> {
  const participant = await verifyRecipient({
    recipientAddress: options.recipientAddress,
    useTestNetwork: options.useTestNetwork,
  });

  const referenceByDocType = new Map<string, string>();
  for (const reference of participant.serviceMetadataReferences) {
    const docTypeId = docTypeIdFromServiceMetadataRef(reference);
    if (docTypeId && !referenceByDocType.has(docTypeId)) {
      referenceByDocType.set(docTypeId, reference);
    }
  }

  const processIdsByDocType = new Map<string, Promise<string[]>>();

  return {
    supportsDocType: (docTypeId) => referenceByDocType.has(docTypeId),
    getProcessIds: (docTypeId) => {
      const pending = processIdsByDocType.get(docTypeId);
      if (pending) return pending;

      const reference = referenceByDocType.get(docTypeId);
      if (!reference) return Promise.resolve([]);

      // A document type whose metadata cannot be read is one we cannot claim the
      // recipient is reachable over, so it drops out of the routing rather than
      // failing the send: another document type may still carry it.
      const processIds = fetchServiceProcessIds(reference).catch((error) => {
        console.error(
          `Failed to read service metadata for ${docTypeId}:`,
          error,
        );
        return [] as string[];
      });
      processIdsByDocType.set(docTypeId, processIds);
      return processIds;
    },
  };
}

/**
 * Look up what a recipient is able to receive, so a send that names no document type
 * identifier can be routed over a combination the recipient is registered for.
 *
 * Returns null when the recipient could not be looked up at all — an unreachable SMP, an
 * unregistered participant, an address that is not a company in this playground. Nothing
 * is known then, so the caller keeps to its own default rather than refusing to send.
 */
export async function getRecipientCapabilities(options: {
  recipientAddress: string;
  isPlayground: boolean;
  useTestNetwork: boolean;
  teamId: string;
}): Promise<RecipientCapabilities | null> {
  const key = cacheKey(options);
  const cached = readCache(key);
  if (cached) return cached;

  try {
    const capabilities =
      options.isPlayground && !options.useTestNetwork
        ? await getPlaygroundCapabilities({
            recipientAddress: options.recipientAddress,
            playgroundTeamId: options.teamId,
          })
        : await getSmpCapabilities({
            recipientAddress: options.recipientAddress,
            useTestNetwork: options.useTestNetwork,
          });
    writeCache(key, capabilities);
    return capabilities;
  } catch (error) {
    // Not an error in itself: an address that is not registered on this network is one
    // the send fails on anyway, and one that is not a company in this playground never
    // receives anything. Logged rather than raised, because the send carries on with the
    // format it would have been written as before.
    console.log(
      `Could not look up receiving capabilities for ${options.recipientAddress}, sending as the default document type:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
