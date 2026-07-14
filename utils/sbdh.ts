import { randomUUID } from "node:crypto";

// Namespace of the Peppol Business Message Envelope's BinaryContent element,
// used to carry non-XML payloads (e.g. Factur-X PDFs) inside an SBD.
const PEPPOL_ENVELOPE_NAMESPACE = "http://peppol.eu/xsd/ticc/envelope/1.0";
const SBDH_NAMESPACE =
  "http://www.unece.org/cefact/namespaces/StandardBusinessDocumentHeader";
const PARTICIPANT_AUTHORITY = "iso6523-actorid-upis";

type SbdhDocumentIdentification = {
  standard: string;
  type: string;
  typeVersion: string;
};

export type SbdhPayload =
  | { kind: "xml"; xml: string }
  | { kind: "binary"; base64Content: string; mimeType: string };

// Derives the SBDH DocumentIdentification from a Peppol document type
// identifier of the form "<standard>::<type>##<customization>::<version>".
// Non-XML document types (e.g. "urn:peppol:doctype:pdf+xml##...") have no
// "<type>" part; the Peppol France Factur-X profile prescribes fixed values
// for them instead.
export function parseSbdhDocumentIdentification(
  docTypeId: string
): SbdhDocumentIdentification | null {
  const hashIndex = docTypeId.indexOf("##");
  if (hashIndex === -1) {
    return null;
  }
  const syntaxPart = docTypeId.slice(0, hashIndex);
  const rest = docTypeId.slice(hashIndex + 2);
  const versionIndex = rest.lastIndexOf("::");
  if (versionIndex === -1) {
    return null;
  }
  const typeVersion = rest.slice(versionIndex + 2);

  const typeIndex = syntaxPart.lastIndexOf("::");
  if (typeIndex === -1) {
    if (syntaxPart === "urn:peppol:doctype:pdf+xml") {
      return { standard: syntaxPart, type: "Invoice", typeVersion: "0" };
    }
    return null;
  }

  return {
    standard: syntaxPart.slice(0, typeIndex),
    type: syntaxPart.slice(typeIndex + 2),
    typeVersion,
  };
}

// Extracts the business document from a Standard Business Document, returning
// the payload XML as-is (no re-serialization) or the decoded content of a
// Peppol BinaryContent element. Input that is not an SBD is returned unchanged.
export function extractStandardBusinessDocumentPayload(
  xml: string
):
  | { kind: "xml"; xml: string }
  | { kind: "binary"; content: Buffer; mimeType: string } {
  const headerClose = xml.match(
    /<\/(?:[\w.-]+:)?StandardBusinessDocumentHeader\s*>/
  );
  if (!headerClose || headerClose.index === undefined) {
    return { kind: "xml", xml };
  }

  const payloadStart = headerClose.index + headerClose[0].length;
  const documentClose = xml.match(/<\/(?:[\w.-]+:)?StandardBusinessDocument\s*>\s*$/);
  const payload = xml.slice(payloadStart, documentClose?.index ?? xml.length).trim();

  const binaryContent = payload.match(
    /^<(?:[\w.-]+:)?BinaryContent\b([^>]*)>([\s\S]*)<\/(?:[\w.-]+:)?BinaryContent\s*>$/
  );
  if (binaryContent) {
    const mimeType =
      binaryContent[1].match(/mimeType\s*=\s*"([^"]*)"/)?.[1] ??
      "application/octet-stream";
    return {
      kind: "binary",
      content: Buffer.from(binaryContent[2].replace(/\s/g, ""), "base64"),
      mimeType,
    };
  }

  return { kind: "xml", xml: payload };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripXmlDeclaration(xml: string): string {
  return xml.replace(/^\s*<\?xml[^?]*\?>\s*/i, "");
}

export function buildStandardBusinessDocument(options: {
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
  countryC1: string;
  documentIdScheme: string;
  processIdScheme: string;
  payload: SbdhPayload;
}): { xml: string; instanceIdentifier: string } {
  const identification = parseSbdhDocumentIdentification(options.docTypeId);
  if (!identification) {
    throw new Error(
      `Cannot derive SBDH document identification from document type ${options.docTypeId}`
    );
  }

  const instanceIdentifier = randomUUID();
  const creationDateAndTime = new Date().toISOString();

  const payloadXml =
    options.payload.kind === "xml"
      ? stripXmlDeclaration(options.payload.xml)
      : `<BinaryContent xmlns="${PEPPOL_ENVELOPE_NAMESPACE}" mimeType="${escapeXml(options.payload.mimeType)}">${options.payload.base64Content}</BinaryContent>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<StandardBusinessDocument xmlns="${SBDH_NAMESPACE}">
  <StandardBusinessDocumentHeader>
    <HeaderVersion>1.0</HeaderVersion>
    <Sender>
      <Identifier Authority="${PARTICIPANT_AUTHORITY}">${escapeXml(options.senderId)}</Identifier>
    </Sender>
    <Receiver>
      <Identifier Authority="${PARTICIPANT_AUTHORITY}">${escapeXml(options.receiverId)}</Identifier>
    </Receiver>
    <DocumentIdentification>
      <Standard>${escapeXml(identification.standard)}</Standard>
      <TypeVersion>${escapeXml(identification.typeVersion)}</TypeVersion>
      <InstanceIdentifier>${instanceIdentifier}</InstanceIdentifier>
      <Type>${escapeXml(identification.type)}</Type>
      <CreationDateAndTime>${creationDateAndTime}</CreationDateAndTime>
    </DocumentIdentification>
    <BusinessScope>
      <Scope>
        <Type>DOCUMENTID</Type>
        <InstanceIdentifier>${escapeXml(options.docTypeId)}</InstanceIdentifier>
        <Identifier>${escapeXml(options.documentIdScheme)}</Identifier>
      </Scope>
      <Scope>
        <Type>PROCESSID</Type>
        <InstanceIdentifier>${escapeXml(options.processId)}</InstanceIdentifier>
        <Identifier>${escapeXml(options.processIdScheme)}</Identifier>
      </Scope>
      <Scope>
        <Type>COUNTRY_C1</Type>
        <InstanceIdentifier>${escapeXml(options.countryC1)}</InstanceIdentifier>
      </Scope>
    </BusinessScope>
  </StandardBusinessDocumentHeader>
  ${payloadXml}
</StandardBusinessDocument>`;

  return { xml, instanceIdentifier };
}
