export function parsePeppolAddress(address: string): {schemeId: string, identifier: string} {
  const parts = address.split(":");
  if(parts.length !== 2){
    throw new Error(`Invalid peppol address (${address})`);
  }
  // Participant identifiers are stored lowercase (SMP lookups and DNS hashing
  // require it), but several BIS content rules expect the uppercase form in the
  // document itself, e.g. PEPPOL-COMMON-R042 for Danish CVR numbers (0184).
  // Identifier values are case insensitive on the network, so uppercasing here
  // is safe for every scheme.
  return { schemeId: parts[0].trim(), identifier: parts[1].trim().toUpperCase() };
}
