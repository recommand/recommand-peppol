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
