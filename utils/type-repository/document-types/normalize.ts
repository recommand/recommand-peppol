/**
 * Trims a value the document names, collapsing an absent or blank one to null.
 */
export function normalize(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
