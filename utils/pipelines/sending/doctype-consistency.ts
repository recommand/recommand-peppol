import { XMLParser } from "fast-xml-parser";
import { normalizeProcessId } from "@peppol/utils/parsing/process-id";
import { getTextContent } from "@peppol/utils/parsing/xml-helpers";
import {
  detectDocumentFormat,
  documentFormats,
} from "@peppol/utils/type-repository/document-formats";
import {
  parseXmlForDetection,
  selfDeclaredDocTypeId,
} from "@peppol/utils/type-repository/document-formats/xml-detection";
import { SendingFailure } from "./errors";

/**
 * Refuses a raw XML send whose requested doc type id contradicts the document.
 *
 * The doc type id is what goes into the envelope, and what the receiving side routes
 * and validates the document by. A Peppol doc type id is
 * `<root namespace>::<root element>##<customization id>::<version>` (Peppol Policy for
 * use of Identifiers 4.4.0, POLICY 20), and its customization id must correspond to the
 * document's own `cbc:CustomizationID` or CII guideline ID (POLICY 18 and 19). A credit
 * note sent as an invoice, or an XRechnung sent as Peppol BIS, reaches the recipient as
 * something it is not.
 *
 * Only a plain contradiction is refused. Whatever the document does not state, an
 * identifier this does not understand, and the version part are left alone, as are
 * differences in case and whitespace. A customization id only counts when the document's
 * is one a registered format recognises: some specifications, the French ones, name
 * their documents differently from their doc type ids on purpose.
 */
export function assertDocTypeIdMatchesXml(
  xml: string,
  docTypeId: string,
  processId?: string
): void {
  const requested = parseDocTypeId(docTypeId);
  if (!requested) return;
  const document = documentRoot(xml);
  if (!document) return;
  // An enveloped document has the envelope as its root; what it carries is not compared.
  if (document.element === "StandardBusinessDocument") return;

  const process = processId ? normalizeProcessId(processId) : undefined;
  const conflicts: string[] = [];

  if (
    !same(document.element, requested.rootElement) ||
    (document.namespace !== undefined &&
      !same(document.namespace, requested.rootNamespace))
  ) {
    conflicts.push(
      `the doctypeId names root element ${requested.rootElement} in namespace ${requested.rootNamespace}, but the document's root element is ${document.element}${document.namespace ? ` in namespace ${document.namespace}` : ""}`
    );
  }

  const customizationId = document.customizationId;
  if (
    customizationId &&
    !related(customizationId, requested.customizationId) &&
    contradictsKnownFormat(xml, requested.customizationId, process)
  ) {
    conflicts.push(
      `the doctypeId names customization ${requested.customizationId}, but the document declares ${customizationId}`
    );
  }

  if (conflicts.length === 0) return;

  const derived =
    detectDocumentFormat(xml, { processId: process })?.docTypeId ??
    selfDeclaredDocTypeId(xml);
  throw new SendingFailure(
    `The doctypeId does not match the XML document: ${conflicts.join("; ")}. ` +
      "The recipient would receive and validate the document as something it is not. " +
      (derived
        ? `Leave doctypeId out to have it derived from the document (which gives ${derived}), or correct it to match the document.`
        : "Correct the doctypeId to match the document, or correct the document."),
    400
  );
}

type DocTypeIdParts = {
  rootNamespace: string;
  rootElement: string;
  customizationId: string;
};

const DOCUMENT_ID_SCHEMES = ["busdox-docid-qns::", "peppol-doctype-wildcard::"];

/** The parts of a doc type id in the Peppol layout, or nothing for any other layout. */
function parseDocTypeId(docTypeId: string): DocTypeIdParts | undefined {
  let value = docTypeId.trim();
  const scheme = DOCUMENT_ID_SCHEMES.find((prefix) =>
    value.toLowerCase().startsWith(prefix)
  );
  if (scheme) value = value.slice(scheme.length);

  const separator = value.indexOf("##");
  if (separator === -1) return undefined;
  const root = value.slice(0, separator);
  const rest = value.slice(separator + 2);

  // `urn:peppol:doctype:pdf+xml` names a container rather than an XML root element.
  const elementSeparator = root.lastIndexOf("::");
  if (elementSeparator === -1) return undefined;
  const rootNamespace = root.slice(0, elementSeparator);
  if (rootNamespace.includes("::")) return undefined;

  const versionSeparator = rest.lastIndexOf("::");
  return {
    rootNamespace,
    rootElement: root.slice(elementSeparator + 2),
    customizationId: versionSeparator === -1 ? rest : rest.slice(0, versionSeparator),
  };
}

type DocumentRoot = {
  element: string;
  namespace?: string;
  customizationId: string;
};

/** The root element of the document, with the namespace bound to its prefix. */
function documentRoot(xml: string): DocumentRoot | undefined {
  let parsed: Record<string, any>;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    }).parse(xml);
  } catch {
    return undefined;
  }

  for (const [name, content] of Object.entries(parsed)) {
    if (name.startsWith("?")) continue;
    if (!content || typeof content !== "object") continue;
    const colon = name.indexOf(":");
    const prefix = colon === -1 ? undefined : name.slice(0, colon);
    const namespace = content[prefix ? `@_xmlns:${prefix}` : "@_xmlns"];
    return {
      element: name.slice(colon + 1),
      namespace: typeof namespace === "string" ? namespace : undefined,
      customizationId:
        getTextContent(child(content, "CustomizationID")) ||
        getTextContent(
          child(
            child(
              child(content, "ExchangedDocumentContext"),
              "GuidelineSpecifiedDocumentContextParameter"
            ),
            "ID"
          )
        ),
    };
  }
  return undefined;
}

function child(element: any, localName: string): any {
  if (!element || typeof element !== "object") return undefined;
  for (const [name, value] of Object.entries(element)) {
    if (name === localName || name.endsWith(`:${localName}`)) return value;
  }
  return undefined;
}

/**
 * Whether the document is one a registered format recognises, under no format that is sent
 * with the requested customization id. A French CIUS invoice declares plain EN 16931, and
 * a French CDAR a guideline of its own, while their doc type ids say otherwise.
 */
function contradictsKnownFormat(
  xml: string,
  requestedCustomizationId: string,
  processId: string | undefined
): boolean {
  const parsed = parseXmlForDetection(xml);
  if (!parsed) return false;
  const recognising = documentFormats.filter((format) =>
    [processId, ...format.supportedProcessIds].some((candidate) =>
      format.isFormat?.(parsed, { processId: candidate })
    )
  );
  if (recognising.length === 0) return false;
  return !recognising.some((format) => {
    const parts = parseDocTypeId(format.docTypeId);
    return parts !== undefined && related(parts.customizationId, requestedCustomizationId);
  });
}

function normalize(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function same(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/**
 * Customization ids that are equal, or one of which extends the other: a document declaring
 * plain EN 16931 can travel as any CIUS of it, and a CIUS extension as the CIUS.
 */
function related(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  return x.startsWith(y) || y.startsWith(x);
}
