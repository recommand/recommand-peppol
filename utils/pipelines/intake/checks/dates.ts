import type { Finding } from "@peppol/types/intake";

// A numeric date such as 03/02/2026 is 3 February in Europe and 2 March in the United
// States. A model picks one reading and is often not aware of the other, so the text
// layer of the PDF is used to find the dates that it could have read the other way.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC_DATE = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/g;

type Order = "day-first" | "month-first";

/** The order that the numeric dates of the text show, when one of them can only be read one way. */
function printedOrder(text: string): Order | null {
  let dayFirst = false;
  let monthFirst = false;
  for (const [, first, second] of text.matchAll(NUMERIC_DATE)) {
    const a = Number(first);
    const b = Number(second);
    if (a > 12 && b <= 12) dayFirst = true;
    if (b > 12 && a <= 12) monthFirst = true;
  }
  return dayFirst === monthFirst ? null : dayFirst ? "day-first" : "month-first";
}

/** Whether the text prints this day and month as a numeric date of this year, in this order. */
function prints(text: string, first: number, second: number, year: string) {
  for (const [, a, b, y] of text.matchAll(NUMERIC_DATE)) {
    if (Number(a) === first && Number(b) === second && (y === year || y === year.slice(2))) {
      return true;
    }
  }
  return false;
}

function isoDates(value: unknown, pointer = ""): { pointer: string; value: string }[] {
  if (typeof value === "string") {
    return ISO_DATE.test(value) ? [{ pointer, value }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => isoDates(item, `${pointer}/${index}`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => isoDates(item, `${pointer}/${key}`));
  }
  return [];
}

/**
 * A finding for each date of an extracted document that the text layer prints only as
 * a numeric date that can also be read with day and month swapped, unless another date
 * of the text shows the order, or the model already reported the date as uncertain.
 * A scanned PDF has no text layer and gets no findings here.
 */
export function ambiguousDateFindings(document: unknown, text: string | undefined, reported: Finding[]): Finding[] {
  if (!text || printedOrder(text)) {
    return [];
  }
  const uncertain = new Set(reported.map((finding) => finding.pointer));
  const findings: Finding[] = [];
  for (const { pointer, value } of isoDates(document)) {
    const [, year, month, day] = ISO_DATE.exec(value)!;
    const d = Number(day);
    const m = Number(month);
    if (d > 12 || d === m || uncertain.has(`/content${pointer}`)) {
      continue;
    }
    const readDayFirst = prints(text, d, m, year);
    const readMonthFirst = prints(text, m, d, year);
    if (readDayFirst === readMonthFirst) {
      continue;
    }
    const other = `${year}-${day}-${month}`;
    const printed = readDayFirst ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
    findings.push({
      code: "ambiguous_date",
      severity: "warning",
      scope: "extraction",
      message: `The document prints the date as ${printed}, which can also be read as ${other}. It was read as ${value}.`,
      pointer: `/content${pointer}`,
    });
  }
  return findings;
}
