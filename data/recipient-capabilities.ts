import {
  resolvePlaygroundAddress,
  type PlaygroundRecipient,
} from "@peppol/data/playground/recipients";
import {
  docTypeIdFromServiceMetadataRef,
  fetchServiceProcessIds,
  verifyRecipient,
} from "@peppol/data/recipient";

/**
 * What a recipient can receive, as far as the network we are sending over knows it.
 *
 * The document types are known up front: production and the test network list them in
 * the participant's service group, a playground company in its registrations. The
 * processes behind one document type cost an extra request on the real networks, so
 * they are fetched only for the document types actually considered, and remembered for
 * the rest of the lookup's life.
 */
export type RecipientCapabilities = {
  supportsDocType(docTypeId: string): boolean;
  getProcessIds(docTypeId: string): Promise<string[]>;
};

/** How long a looked-up participant stays usable, so a batch of sends pays for one lookup. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

const cache = new Map<string, { expiresAt: number; capabilities: RecipientCapabilities }>();

function cacheKey(options: { recipientAddress: string; useTestNetwork: boolean }): string {
  const network = options.useTestNetwork ? "test" : "production";
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
 * of an SMP entry for its own companies.
 */
function getPlaygroundCapabilities(recipient: PlaygroundRecipient): RecipientCapabilities {
  const processIdsByDocType = new Map<string, string[]>();
  for (const registration of recipient.registrations) {
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
 * A playground that is not on the test network answers an address that belongs to one
 * of its companies from that company's registrations, and any other address from the
 * production SMP, as production would; see isSimulatedPlayground. The playground's
 * registrations are read fresh each time, the network's are cached.
 *
 * Returns null when the recipient could not be looked up at all — an unreachable SMP, an
 * unregistered participant, one of the addresses a playground reserves for that case.
 * Nothing is known then, so the caller keeps to its own default rather than refusing to
 * send.
 */
export async function getRecipientCapabilities(options: {
  recipientAddress: string;
  isPlayground: boolean;
  useTestNetwork: boolean;
  teamId: string;
}): Promise<RecipientCapabilities | null> {
  try {
    if (options.isPlayground && !options.useTestNetwork) {
      const playgroundAddress = await resolvePlaygroundAddress({
        recipientAddress: options.recipientAddress,
        playgroundTeamId: options.teamId,
      });
      if (playgroundAddress?.kind === "unknown") return null;
      if (playgroundAddress?.kind === "company") {
        return getPlaygroundCapabilities(playgroundAddress.recipient);
      }
    }

    const key = cacheKey(options);
    const cached = readCache(key);
    if (cached) return cached;

    const capabilities = await getSmpCapabilities({
      recipientAddress: options.recipientAddress,
      useTestNetwork: options.useTestNetwork,
    });
    writeCache(key, capabilities);
    return capabilities;
  } catch (error) {
    // Not an error in itself: an address that is not registered on this network is one
    // the send fails on anyway. Logged rather than raised, because the send carries on
    // with the format it would have been written as before.
    console.log(
      `Could not look up receiving capabilities for ${options.recipientAddress}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
