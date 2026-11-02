import { XMLValidator } from "fast-xml-parser";
import type { FileFormat } from "@peppol/types/intake";

const PDF_HEADER = Buffer.from("%PDF-");
// Readers accept a header after up to 1024 bytes of other content.
const PDF_HEADER_WINDOW = 1024;

/** Decode XML bytes as text, without a byte order mark. */
export function xmlText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/**
 * What a file is, read from its content rather than from a declared media type: a PDF
 * by its header, XML when it is a well-formed XML document. Null for anything else.
 */
export function detectFileKind(bytes: Uint8Array): "pdf" | "xml" | null {
  const head = Buffer.from(bytes.subarray(0, PDF_HEADER_WINDOW + PDF_HEADER.length));
  if (head.indexOf(PDF_HEADER) !== -1) {
    return "pdf";
  }
  const text = xmlText(bytes).trimStart();
  if (text.startsWith("<") && XMLValidator.validate(text) === true) {
    return "xml";
  }
  return null;
}

/** The syntax of an XML business document, by the namespace of its root element. */
export function xmlFormat(xml: string): FileFormat {
  const root = xml.match(/<(?!\?|!)([^\s>]+)[^>]*>/)?.[0] ?? "";
  if (root.includes("urn:oasis:names:specification:ubl:schema:xsd:")) {
    return "ubl";
  }
  if (root.includes("urn:un:unece:uncefact:data:standard:CrossIndustryInvoice")) {
    return "cii";
  }
  return "xml";
}

export const MEDIA_TYPES = { pdf: "application/pdf", xml: "application/xml" } as const;
