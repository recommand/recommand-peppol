import { XMLParser } from "fast-xml-parser";
import { getTextContent } from "@peppol/utils/parsing/xml-helpers";

/**
 * An XML document parsed for detection: namespace prefixes stripped, so a format reads
 * `document.Invoice` regardless of which prefix the sender bound the namespace to.
 * `isFormat` receives this rather than the raw string because detection asks every
 * format in turn, and parsing once is what keeps that a single pass over the document.
 */
export type ParsedXmlDocument = Record<string, any>;

export function parseXmlForDetection(
  xml: string
): ParsedXmlDocument | undefined {
  try {
    return new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
    }).parse(xml);
  } catch (error) {
    console.error("Failed to parse XML for format detection:", error);
    return undefined;
  }
}

/** `cbc:CustomizationID`, the specification a UBL document names itself against. */
export function ublCustomizationId(root: any): string {
  return getTextContent(root?.CustomizationID);
}

/** `ram:GuidelineSpecifiedDocumentContextParameter/ram:ID`, the CII equivalent. */
export function ciiGuidelineId(root: any): string {
  return getTextContent(
    root?.ExchangedDocumentContext?.GuidelineSpecifiedDocumentContextParameter?.ID
  );
}

/** The document element, skipping the XML declaration fast-xml-parser keeps. */
function rootElement(
  parsed: ParsedXmlDocument
): { name: string; content: any } | undefined {
  for (const [name, content] of Object.entries(parsed)) {
    if (name.startsWith("?")) continue;
    if (!content || typeof content !== "object") continue;
    return { name, content };
  }
  return undefined;
}

/**
 * The doc type id a document states for itself.
 *
 * Sending raw XML is a passthrough: the document belongs to the caller and the
 * platform only has to say what it is transmitting. Both halves of that
 * statement are in the document already — the root element names the schema,
 * and the customization id names the specification it claims compliance with —
 * so an identifier can be written for a document no registered format
 * recognises. That is what keeps a CIUS the platform has never seen, an
 * XRechnung say, sendable at all.
 * 
 * UBL only.
 */
export function selfDeclaredDocTypeId(xml: string): string | undefined {
  const parsed = parseXmlForDetection(xml);
  if (!parsed) return undefined;

  const root = rootElement(parsed);
  if (!root) return undefined;

  const customizationId = ublCustomizationId(root.content);
  if (!customizationId) return undefined;
  // 2.1 because a Peppol UBL document either leaves the UBLVersionID out or
  // sets it to 2.1: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
  return `urn:oasis:names:specification:ubl:schema:xsd:${root.name}-2::${root.name}##${customizationId}::2.1`;
}
