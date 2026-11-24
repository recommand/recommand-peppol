// PostgreSQL refuses a NUL character in a `text` column, and the escape `\u0000` or an
// unpaired surrogate in a `jsonb` value. Writing one fails the whole statement, and it
// fails again on every retry. Text from outside can hold any of them: a PDF may draw a
// dash with a glyph whose text is NUL, and file names, email headers and model output
// are whatever the sender or the model made of them. The other C0 control characters
// are stored fine, but XML 1.0 does not allow them, and extracted values end up in UBL.
//
// Such a character becomes U+FFFD, the replacement character, rather than disappearing:
// deleting it would turn "INV<NUL>0042" into "INV0042", a different-looking
// number, for every check and model that reads the text afterwards.

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** The text with every character PostgreSQL or XML refuses replaced by U+FFFD. Tab, line feed and carriage return stay. */
export function storableText(text: string): string {
  return text.toWellFormed().replace(CONTROL_CHARACTERS, "\uFFFD");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A value with `storableText` applied to every string in it, keys included, through
 * arrays and plain objects. Anything else, such as a date or a buffer, stays as it is.
 */
export function storable<T>(value: T): T {
  if (typeof value === "string") return storableText(value) as T;
  if (Array.isArray(value)) return value.map(storable) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [storableText(key), storable(entry)])) as T;
  }
  return value;
}
