export const MAX_CONTRACT_PDF_SIZE = 20 * 1024 * 1024;

const PDF_HEADER = new TextEncoder().encode("%PDF-");
const PDF_EOF_MARKER = new TextEncoder().encode("%%EOF");
// Readers accept a header preceded by junk within the first 1024 bytes and
// trailing bytes after the last end-of-file marker.
const HEADER_SEARCH_WINDOW = 1024;
const EOF_SEARCH_WINDOW = 2048;

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array, from: number, to: number): number {
  const end = Math.min(to, haystack.length) - needle.length;
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

export function isPdfDocument(bytes: Uint8Array): boolean {
  if (indexOfSequence(bytes, PDF_HEADER, 0, HEADER_SEARCH_WINDOW) === -1) {
    return false;
  }
  return indexOfSequence(bytes, PDF_EOF_MARKER, bytes.length - EOF_SEARCH_WINDOW, bytes.length) !== -1;
}
