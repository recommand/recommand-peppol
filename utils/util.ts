export function createCleanUrl(parts: string[]) {
  // Remove trailing slash from each part
  const cleanParts = parts.map(part => part.replace(/\/$/, ""));
  return cleanParts.join("/");
}

// fixNewlines replaces spaces that are actually newlines in the certificate format
export function fixNewlines(content: string): string {
  // Split by "-----" to handle certificate boundaries
  const parts = content.split("-----");
  for (let i = 0; i < parts.length; i++) {
    // Only process the parts that are between the BEGIN and END markers
    if (i > 0 && i < parts.length - 1 && !parts[i].includes("BEGIN") && !parts[i].includes("END")) {
      parts[i] = parts[i].replace(/ /g, "\n");
    }
  }
  return parts.join("-----");
}

export function cleanVatNumber(vatNumber: string | undefined | null) {
  if (vatNumber === undefined) return undefined;
  if (vatNumber === null) return null;
  // Replace every non-alphanumeric character with an empty string, transform to uppercase
  return vatNumber.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function cleanEnterpriseNumber(enterpriseNumber: string | undefined | null) {
  if (enterpriseNumber === undefined) return undefined;
  if (enterpriseNumber === null) return null;
  // Replace every non-alphanumeric character with an empty string
  return enterpriseNumber.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
