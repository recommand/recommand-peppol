import { describe, expect, it } from "bun:test";
import { isPdfDocument } from "../utils/pdf-validation";

const encode = (value: string) => new TextEncoder().encode(value);

describe("isPdfDocument", () => {
  it("accepts a document with a PDF header and end-of-file marker", () => {
    expect(isPdfDocument(encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"))).toBe(true);
  });

  it("accepts leading bytes before the header and trailing bytes after the marker", () => {
    expect(isPdfDocument(encode("﻿junk%PDF-1.4\n...\n%%EOF\n\n\n"))).toBe(true);
  });

  it("rejects a document without a PDF header", () => {
    expect(isPdfDocument(encode("<html><body>not a pdf</body></html>\n%%EOF"))).toBe(false);
  });

  it("rejects a header that starts after the first 1024 bytes", () => {
    expect(isPdfDocument(encode(`${" ".repeat(1100)}%PDF-1.7\n%%EOF`))).toBe(false);
  });

  it("rejects a truncated document without an end-of-file marker", () => {
    expect(isPdfDocument(encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"))).toBe(false);
  });

  it("rejects an empty upload", () => {
    expect(isPdfDocument(new Uint8Array())).toBe(false);
  });
});
