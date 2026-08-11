export function parsePeppolAddress(address: string): {
  schemeId: string;
  identifier: string;
} {
  const parts = address.split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid peppol address (${address})`);
  }
  return { schemeId: parts[0].trim(), identifier: parts[1].trim() };
}

export function normalizePeppolAddress(address: string | null): string | null {
  if (address === null || address.includes(":")) {
    return address;
  }
  return `0208:${address.replace(/[^0-9]/g, "")}`;
}
