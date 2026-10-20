export function parsePeppolAddress(address: string): {
  schemeId: string;
  identifier: string;
} {
  const parts = address.split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid peppol address (${address})`);
  }
  // Participant identifiers are stored lowercase (SMP lookups and DNS hashing
  // require it), but several BIS content rules expect the uppercase form in the
  // document itself, e.g. PEPPOL-COMMON-R042 for Danish CVR numbers (0184).
  // Identifier values are case insensitive on the network, so uppercasing here
  // is safe for every scheme.
  return { schemeId: parts[0].trim(), identifier: parts[1].trim().toUpperCase() };
}

export function normalizePeppolAddress(address: string | null): string | null {
  if (address === null || address.includes(":")) {
    return address;
  }
  return `0208:${address.replace(/[^0-9]/g, "")}`;
}

/** A participant as the network names it: an ISO 6523 scheme and an identifier under it. */
export type PeppolParticipant = { scheme: string; identifier: string };

const PARTICIPANT_SCHEME_PREFIX = "iso6523-actorid-upis::";

/**
 * Reads a `scheme:identifier` address into its two parts, accepting the participant
 * identifier scheme in front of it. Only the first colon separates them, since an
 * identifier may contain one itself. Null for anything that is not such an address.
 */
export function splitPeppolAddress(address: string): PeppolParticipant | null {
  const trimmed = address.trim();
  const withoutPrefix = trimmed.toLowerCase().startsWith(PARTICIPANT_SCHEME_PREFIX)
    ? trimmed.slice(PARTICIPANT_SCHEME_PREFIX.length)
    : trimmed;
  const separator = withoutPrefix.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  return {
    scheme: withoutPrefix.slice(0, separator).trim(),
    identifier: withoutPrefix.slice(separator + 1).trim(),
  };
}

/**
 * Whether two participants are the same address. Participant identifiers are case
 * insensitive on the network (Peppol Policy for use of Identifiers), so scheme and
 * value are compared without regard to case, after trimming and collapsing whitespace
 * the way XML `normalize-space` reads an element. Nothing else is stripped: a value
 * written with other characters is a different address to whoever compares it next.
 */
export function sameParticipant(a: PeppolParticipant, b: PeppolParticipant): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(a.scheme) === normalize(b.scheme) && normalize(a.identifier) === normalize(b.identifier);
}
