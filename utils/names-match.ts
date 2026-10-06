/**
 * Whether two names are the same person's, ignoring case, accents and extra
 * middle names: every word of the shorter name has to appear in the longer one.
 */
export function namesMatch(a: string, b: string): boolean {
  const partsA = a.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const partsB = b.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const [shorter, longer] = partsA.length <= partsB.length ? [partsA, partsB] : [partsB, partsA];
  return shorter.length > 0 && shorter.every((part) => longer.includes(part));
}
