/**
 * Letters that Unicode does not decompose into a base letter and an accent, as they
 * are commonly written on a keyboard without them: Bjørn as Bjorn or Bjoern, Æsa as
 * Aesa, Åse as Ase or Aase.
 */
const TRANSLITERATIONS: Record<string, string> = {
  ø: "o",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  đ: "d",
  ð: "d",
  þ: "th",
  ł: "l",
};

function nameParts(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[øæœßđðþł]/g, (letter) => TRANSLITERATIONS[letter])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Å, Ø and Æ written with two letters: Aase, Bjoern.
    .replace(/aa/g, "a")
    .replace(/oe/g, "o")
    .replace(/[-']/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether two names are the same person's, ignoring case, accents, hyphens and
 * extra middle names: every word of the shorter name has to appear in the longer
 * one. Letters without an accent to strip, such as ø and æ, match their usual
 * transliterations.
 */
export function namesMatch(a: string, b: string): boolean {
  const partsA = nameParts(a);
  const partsB = nameParts(b);
  const [shorter, longer] = partsA.length <= partsB.length ? [partsA, partsB] : [partsB, partsA];
  return shorter.length > 0 && shorter.every((part) => longer.includes(part));
}
