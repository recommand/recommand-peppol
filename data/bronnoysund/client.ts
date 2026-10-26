// Enhetsregisteret, the Norwegian Central Coordinating Register for Legal Entities,
// kept by the Brønnøysund Register Centre. Its open data API needs no authentication.
// A Norwegian organisation number (ICD 0192) is either a main entity (enhet) or a
// sub-unit (underenhet); both can be Peppol participants, so both registers are read.

const BRREG_ENDPOINT = "https://data.brreg.no";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAYS_MS = [500, 2_000];
const FEED_PAGE_SIZE = 1_000;

/**
 * The Brønnøysund Register Centre could not be reached, or kept answering with a
 * server error after the retries. Callers decide whether that blocks what they are doing.
 */
export class BronnoysundUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BronnoysundUnavailableError";
  }
}

export type BronnoysundClientOptions = {
  fetch?: typeof fetch;
  /** Waits between attempts; one attempt more than there are delays. */
  retryDelaysMs?: readonly number[];
  /** Updates per page of the change feed. */
  feedPageSize?: number;
};

export type OrganisationLookup =
  | { status: "active"; organisationNumber: string; name: string }
  | { status: "deleted"; organisationNumber: string; name: string | null; deletedOn: string | null }
  | { status: "notFound"; organisationNumber: string };

/**
 * GETs a JSON document from data.brreg.no, retrying network failures and server
 * errors. Resolves to null on 404 and 410, which the register uses for numbers it
 * does not know, and on 400, which it answers for a number that is not a valid
 * organisation number at all.
 */
export async function getBronnoysundJson<T>(path: string, options: BronnoysundClientOptions): Promise<T | null> {
  const fetchImpl = options.fetch ?? fetch;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  let lastError = "";
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt - 1]));
    }
    try {
      const response = await fetchImpl(`${BRREG_ENDPOINT}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 400 || response.status === 404 || response.status === 410) {
        return null;
      }
      if (response.ok) {
        return (await response.json()) as T;
      }
      lastError = `HTTP ${response.status}`;
      if (response.status < 500 && response.status !== 429) {
        break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new BronnoysundUnavailableError(`data.brreg.no did not answer ${path}: ${lastError}`);
}

type RegisterEntity = {
  organisasjonsnummer: string;
  navn?: string;
  slettedato?: string;
  respons_klasse?: string;
};

function toLookup(organisationNumber: string, entity: RegisterEntity): OrganisationLookup {
  // A deleted entity is still served, with its deletion date. The response class is
  // checked as well, in case a deleted entity is ever served without the date.
  if (entity.slettedato || entity.respons_klasse?.startsWith("Slettet")) {
    return { status: "deleted", organisationNumber, name: entity.navn ?? null, deletedOn: entity.slettedato ?? null };
  }
  return { status: "active", organisationNumber, name: entity.navn ?? "" };
}

/** Looks an organisation number up as a main entity first, then as a sub-unit. */
export async function lookupOrganisation(
  organisationNumber: string,
  options: BronnoysundClientOptions = {}
): Promise<OrganisationLookup> {
  const number = encodeURIComponent(organisationNumber);
  const entity = await getBronnoysundJson<RegisterEntity>(`/enhetsregisteret/api/enheter/${number}`, options);
  if (entity) {
    return toLookup(organisationNumber, entity);
  }
  const subUnit = await getBronnoysundJson<RegisterEntity>(`/enhetsregisteret/api/underenheter/${number}`, options);
  if (subUnit) {
    return toLookup(organisationNumber, subUnit);
  }
  return { status: "notFound", organisationNumber };
}

type UpdateFeedPage = {
  _embedded?: Record<string, Array<{
    oppdateringsid: number;
    dato: string;
    endringstype: string;
    organisasjonsnummer: string;
  }>>;
};

// "Sletting" is a deletion. "Fjernet" is an entity taken out of the register
// altogether, for example one registered by mistake; it cannot receive either.
const DELETION_CHANGE_TYPES = new Set(["Sletting", "Fjernet"]);

export type DeletedOrganisation = {
  organisationNumber: string;
  deletedAt: string;
};

async function readDeletionFeed(
  register: "enheter" | "underenheter",
  since: Date,
  options: BronnoysundClientOptions
): Promise<DeletedOrganisation[]> {
  const embeddedKey = register === "enheter" ? "oppdaterteEnheter" : "oppdaterteUnderenheter";
  const deleted: DeletedOrganisation[] = [];
  const pageSize = options.feedPageSize ?? FEED_PAGE_SIZE;
  // The feed has no filter on the change type, so every change since the date is
  // read. It is paged by update id rather than page number: page numbers stop at
  // 10,000 results, update ids do not.
  let query = `dato=${encodeURIComponent(since.toISOString())}`;
  for (;;) {
    const page = await getBronnoysundJson<UpdateFeedPage>(
      `/enhetsregisteret/api/oppdateringer/${register}?${query}&size=${pageSize}`,
      options
    );
    const updates = page?._embedded?.[embeddedKey] ?? [];
    for (const update of updates) {
      if (DELETION_CHANGE_TYPES.has(update.endringstype)) {
        deleted.push({ organisationNumber: update.organisasjonsnummer, deletedAt: update.dato });
      }
    }
    if (updates.length < pageSize) {
      return deleted;
    }
    query = `oppdateringsid=${updates[updates.length - 1].oppdateringsid + 1}`;
  }
}

/** Main entities and sub-units deleted from Enhetsregisteret since the given moment. */
export async function fetchDeletedOrganisations(
  since: Date,
  options: BronnoysundClientOptions = {}
): Promise<DeletedOrganisation[]> {
  return [
    ...(await readDeletionFeed("enheter", since, options)),
    ...(await readDeletionFeed("underenheter", since, options)),
  ];
}

