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
