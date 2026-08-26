import { createHash } from "crypto";
import { PARTICIPANT_SCHEME, DOCUMENT_SCHEME, PROCESS_SCHEME } from "./phoss-smp/service-metadata";
import { XMLParser } from "fast-xml-parser";
import { base32Encode } from "@peppol/utils/base32";
import { resolveNaptr } from "@peppol/utils/naptr";
import { resolveDocTypeId } from "@peppol/utils/type-repository/receiving-capabilities";
import { getDocumentTypeName } from "@peppol/utils/document-type-lookup";
import { parseCertificateExpiry } from "@peppol/utils/certificate";

const SML_ZONE = "participant.sml.prod.tech.peppol.org";
const SML_TEST_ZONE = "participant.sml.test.tech.peppol.org";

function stripTrailingEquals(str: string): string {
  return str.replace(/=+$/, "");
}

async function getSmpUrlNaptr({recipientAddress, useTestNetwork}: {recipientAddress: string, useTestNetwork: boolean}): Promise<string | null> {
  const dnsZone = useTestNetwork ? SML_TEST_ZONE : SML_ZONE;
  
  const sha256Hash = createHash("sha256")
    .update(recipientAddress.toLowerCase())
    .digest();
  
  const base32Hash = stripTrailingEquals(base32Encode(sha256Hash));
  const naptrDomain = `${base32Hash}.${PARTICIPANT_SCHEME}.${dnsZone}`.toLowerCase();
  
  const smpUrl = await resolveNaptr(naptrDomain);
  if (smpUrl) {
    const encodedAddress = encodeURIComponent(recipientAddress);
    const baseUrl = smpUrl.endsWith("/") ? smpUrl.slice(0, -1) : smpUrl;
    return `${baseUrl}/${PARTICIPANT_SCHEME}::${encodedAddress}`;
  }
  return null;
}

function getSmpUrlCname({recipientAddress, useTestNetwork}: {recipientAddress: string, useTestNetwork: boolean}): string {
  const dnsZone = useTestNetwork ? SML_TEST_ZONE : SML_ZONE;
  
  const md5Hash = createHash("md5")
    .update(recipientAddress.toLowerCase())
    .digest("hex");
  
  const encodedAddress = encodeURIComponent(recipientAddress);
  
  return `http://B-${md5Hash}.${PARTICIPANT_SCHEME}.${dnsZone}/${PARTICIPANT_SCHEME}::${encodedAddress}`;
}

export async function getSmpUrl({recipientAddress, useTestNetwork}: {recipientAddress: string, useTestNetwork: boolean}): Promise<string> {  
  const naptrUrl = await getSmpUrlNaptr({recipientAddress, useTestNetwork});
  if (naptrUrl) {
    return naptrUrl;
  }
  
  return getSmpUrlCname({recipientAddress, useTestNetwork});
}

const smpXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: true,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

/**
 * Read the document type id out of a ServiceMetadataReference URL, whose path ends in
 * `/services/{scheme}::{docTypeId}`. Returns null for a reference that is not shaped
 * that way, which is all an SMP tells us about a document type we cannot address.
 */
export function docTypeIdFromServiceMetadataRef(ref: string): string | null {
  try {
    const url = new URL(ref);
    const servicesIdx = url.pathname.lastIndexOf("/services/");
    if (servicesIdx === -1) return null;

    const rawDocType = url.pathname.substring(servicesIdx + "/services/".length);
    const decoded = decodeURIComponent(rawDocType);
    // Strip the scheme prefix (e.g. "busdox-docid-qns::")
    const schemeEnd = decoded.indexOf("::");
    return schemeEnd !== -1 ? decoded.substring(schemeEnd + 2) : decoded;
  } catch {
    return null;
  }
}

export async function verifyRecipient({recipientAddress, useTestNetwork}: {recipientAddress: string, useTestNetwork: boolean}) {
  const smpUrl = await getSmpUrl({recipientAddress, useTestNetwork});

  try {
    const response = await fetch(smpUrl);
    if (!response.ok) {
      throw new Error(`Failed to verify recipient: ${response.statusText}`);
    }
    const data = await response.text();

    // Extract service metadata references
    const serviceMetadataRefs: string[] = [];
    // Extract SMP hostnames
    const smpHostnames: Set<string> = new Set();

    // Navigate through the XML structure to find ServiceMetadataReference elements
    try {
      const xmlDoc = smpXmlParser.parse(data);
      // Handle different possible XML structures
      const serviceGroup = xmlDoc.ServiceGroup || xmlDoc["smp:ServiceGroup"];

      if (serviceGroup) {
        // Extract participant identifier
        const participantId = serviceGroup.ParticipantIdentifier || 
                            serviceGroup["id:ParticipantIdentifier"];
        
        const refCollection = serviceGroup.ServiceMetadataReferenceCollection || 
                            serviceGroup["smp:ServiceMetadataReferenceCollection"];
        
        if (refCollection) {
          const references = refCollection.ServiceMetadataReference || 
                           refCollection["smp:ServiceMetadataReference"];
          
          if (references) {
            // Handle both single reference and array of references
            const refArray = Array.isArray(references) ? references : [references];
            
            for (const ref of refArray) {
              if (ref && ref["@_href"]) {
                serviceMetadataRefs.push(ref["@_href"]);
                const url = new URL(ref["@_href"]);
                smpHostnames.add(url.hostname);
              }
            }
          }
        }
      }
    } catch (parseError) {
    }
    
    // Derive supportedDocuments from service metadata reference URLs
    const supportedDocuments = serviceMetadataRefs.map(ref => {
      const docTypeId = docTypeIdFromServiceMetadataRef(ref);
      if (!docTypeId) return null;
      return { name: getDocumentTypeName(docTypeId), docTypeId };
    }).filter((d): d is { name: string; docTypeId: string } => d !== null);

    return {
      smpUrl,
      serviceMetadataReferences: serviceMetadataRefs,
      smpHostnames: Array.from(smpHostnames),
      supportedDocuments,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to verify recipient: ${error.message}`);
    }
    throw new Error("Failed to verify recipient: Unknown error occurred");
  }
}

export type ServiceMetadataResult = {
  serviceProvider: string | null;
  serviceEndpoint: string | null;
  technicalContact: string | null;
  certificateExpiry: string | null;
};

/**
 * Bring a process id to its `scheme::value` form, so a caller-supplied id and an SMP
 * ProcessIdentifier (which carries its scheme in an attribute) can be compared. An
 * unqualified id is assumed to use the default process scheme.
 */
function qualifiedProcessId(value: unknown): string | null {
  if (typeof value === "string") {
    const processId = value.trim();
    return processId.includes("::") ? processId : `${PROCESS_SCHEME}::${processId}`;
  }
  const node = value as { "#text"?: unknown; "@_scheme"?: unknown } | undefined;
  if (typeof node?.["#text"] !== "string") return null;
  return `${node["@_scheme"] ?? PROCESS_SCHEME}::${node["#text"].trim()}`;
}

/**
 * Fetch a ServiceMetadata XML from an SMP and parse endpoint details.
 * When a processId is given, only the matching process is considered.
 */
export async function fetchServiceMetadata(serviceMetadataUrl: string, options?: { processId?: string }): Promise<ServiceMetadataResult | null> {
  try {
    const response = await fetch(serviceMetadataUrl);
    if (!response.ok) return null;

    const xml = await response.text();
    const doc = smpXmlParser.parse(xml);

    // Navigate: ServiceMetadata > ServiceInformation > ProcessList > Process > ServiceEndpointList > Endpoint
    const serviceMetadata = doc.ServiceMetadata || doc.SignedServiceMetadata?.ServiceMetadata;
    const serviceInfo = serviceMetadata?.ServiceInformation;
    const processList = serviceInfo?.ProcessList;
    const processes = Array.isArray(processList?.Process)
      ? processList.Process
      : processList?.Process
        ? [processList.Process]
        : [];
    const expectedProcessId = options?.processId ? qualifiedProcessId(options.processId) : null;
    const process = expectedProcessId
      ? processes.find((p: any) => qualifiedProcessId(p?.ProcessIdentifier) === expectedProcessId)
      : processes[0];
    const endpointList = process?.ServiceEndpointList;
    const endpoint = Array.isArray(endpointList?.Endpoint) ? endpointList.Endpoint[0] : endpointList?.Endpoint;

    if (!endpoint) return null;

    const endpointRef = endpoint.EndpointReference;
    const serviceEndpoint: string | null = endpointRef?.Address ?? null;

    const rawCert: string | null = endpoint.Certificate ?? null;
    const certificateExpiry = rawCert ? parseCertificateExpiry(rawCert) : null;

    return {
      serviceProvider: endpoint.ServiceDescription ?? null,
      serviceEndpoint,
      technicalContact: endpoint.TechnicalContactUrl ?? null,
      certificateExpiry,
    };
  } catch {
    return null;
  }
}

/**
 * List the process ids a ServiceMetadata registration is addressable over, in the order
 * the SMP states them. The scheme is dropped so the ids compare against the ones the
 * document format registry declares, which are written unqualified.
 */
export async function fetchServiceProcessIds(serviceMetadataUrl: string): Promise<string[]> {
  const response = await fetch(serviceMetadataUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch service metadata: ${response.statusText}`);
  }

  const doc = smpXmlParser.parse(await response.text());
  const serviceMetadata = doc.ServiceMetadata || doc.SignedServiceMetadata?.ServiceMetadata;
  const processList = serviceMetadata?.ServiceInformation?.ProcessList;
  const processes = Array.isArray(processList?.Process)
    ? processList.Process
    : processList?.Process
      ? [processList.Process]
      : [];

  return processes
    .map((process: any) => qualifiedProcessId(process?.ProcessIdentifier))
    .filter((processId: string | null): processId is string => processId !== null)
    .map((processId: string) => processId.substring(processId.indexOf("::") + 2));
}

export async function verifyDocumentSupport({recipientAddress, documentType, processId, useTestNetwork}: {recipientAddress: string, documentType: string, processId?: string, useTestNetwork: boolean}) {
  const smpUrl = await getSmpUrl({recipientAddress, useTestNetwork});

  // Map the document type to the Peppol document type code, if not possible, just use the document type as is
  documentType = resolveDocTypeId(documentType);

  // Encode the document type for URL safety
  const encodedDocumentType = encodeURIComponent(documentType);

  // Construct SMP URL according to Peppol spec with proper encoding
  const smpUrlWithDocumentType = `${smpUrl}/services/${DOCUMENT_SCHEME}::${encodedDocumentType}`;

  const endpointDetails = await fetchServiceMetadata(smpUrlWithDocumentType, { processId });

  if (!endpointDetails) {
    throw new Error("Failed to verify document type capabilities: no endpoint found");
  }

  return {
    smpUrl: smpUrlWithDocumentType,
    endpointDetails,
  };
}

/**
 * Fetch business card from an SMP server.
 * Returns null if the SMP doesn't support business cards (404).
 */
export async function fetchBusinessCard({smpUrl, participantId}: {smpUrl: string, participantId: string}): Promise<{
  companyName: string | null;
  countryCode: string | null;
} | null> {
  try {
    // Extract SMP base URL (everything before the participant identifier path)
    const url = new URL(smpUrl);
    const baseUrl = `${url.protocol}//${url.host}`;

    const bcUrl = `${baseUrl}/businesscard/${PARTICIPANT_SCHEME}::${encodeURIComponent(participantId)}`;
    const response = await fetch(bcUrl);
    if (!response.ok) return null;

    const xml = await response.text();
    const doc = smpXmlParser.parse(xml);

    const businessCard = doc.BusinessCard;
    if (!businessCard) return null;

    const entity = Array.isArray(businessCard.BusinessEntity)
      ? businessCard.BusinessEntity[0]
      : businessCard.BusinessEntity;

    if (!entity) return null;

    const nameObj = Array.isArray(entity.Name) ? entity.Name[0] : entity.Name;
    const companyName: string | null = (typeof nameObj === "string" ? nameObj : nameObj?.["#text"]) ?? null;
    const countryCode: string | null = entity.CountryCode ?? null;

    return { companyName, countryCode };
  } catch {
    return null;
  }
}
