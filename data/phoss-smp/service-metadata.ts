import { fixNewlines, UserFacingError } from "@peppol/utils/util";
import { fetchSmp } from "./client";
import { XMLBuilder } from "fast-xml-parser";

export const PARTICIPANT_SCHEME = "iso6523-actorid-upis";
export const DOCUMENT_SCHEME = "busdox-docid-qns";
export const PROCESS_SCHEME = "cenbii-procid-ubl";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

export async function registerServiceMetadata({
  peppolIdentifierEas,
  peppolIdentifierAddress,
  documentTypeCode,
  documentProcessIdCode,
  useTestNetwork,
}:{
  peppolIdentifierEas: string;
  peppolIdentifierAddress: string;
  documentTypeCode: string;
  documentProcessIdCode: string;
  useTestNetwork: boolean;
}) {
  const serviceGroupId = `${peppolIdentifierEas}:${peppolIdentifierAddress}`;
  const documentTypeId = `${DOCUMENT_SCHEME}::${documentTypeCode}`;
  
  // Encode the document type id
  const encodedDocumentTypeId = encodeURIComponent(documentTypeId);

  let fixedCert: string;
  let as4Address: string;

  if (useTestNetwork) {
    if (!process.env.AP_TEST_CERT) {
      throw new Error("AP_TEST_CERT environment variable is not set");
    }
  
    // Fix newlines in certificate content
    fixedCert = fixNewlines(process.env.AP_TEST_CERT);
    as4Address = "https://test-ap.net.recommand.com/as4";
  }else{
    if (!process.env.AP_CERT) {
      throw new Error("AP_CERT environment variable is not set");
    }
  
    // Fix newlines in certificate content
    fixedCert = fixNewlines(process.env.AP_CERT);
    as4Address = "https://ap.net.recommand.com/as4";
  }


  // Create the XML body according to the Peppol style
  const serviceMetadataXml = {
    "smp:ServiceMetadata": {
      "@_xmlns:wsa": "http://www.w3.org/2005/08/addressing",
      "@_xmlns:smp": "http://busdox.org/serviceMetadata/publishing/1.0/",
      "@_xmlns:id": "http://busdox.org/transport/identifiers/1.0/",
      "smp:ServiceInformation": {
        "id:ParticipantIdentifier": {
          "@_scheme": PARTICIPANT_SCHEME,
          "#text": serviceGroupId
        },
        "id:DocumentIdentifier": {
          "@_scheme": DOCUMENT_SCHEME,
          "#text": documentTypeCode
        },
        "smp:ProcessList": {
          "smp:Process": {
            "id:ProcessIdentifier": {
              "@_scheme": PROCESS_SCHEME,
              "#text": documentProcessIdCode
            },
            "smp:ServiceEndpointList": {
              "smp:Endpoint": {
                "@_transportProfile": "peppol-transport-as4-v2_0",
                "wsa:EndpointReference": {
                  "wsa:Address": as4Address
                },
                "smp:RequireBusinessLevelSignature": false,
                "smp:Certificate": fixedCert,
                "smp:ServiceDescription": "Recommand AS4 Service",
                "smp:TechnicalContactUrl": "https://recommand.com"
              }
            }
          }
        }
      }
    }
  };

  const response = await fetchSmp(
    `${PARTICIPANT_SCHEME}::${serviceGroupId}/services/${encodedDocumentTypeId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/xml"
      },
      body: builder.build(serviceMetadataXml),
      useTestNetwork,
    }
  );

  if (!response.ok) {
    console.error(await response.text());
    throw new UserFacingError("Failed to register service metadata in SMP");
  }

  return true;
}

export async function deleteServiceMetadata({
  peppolIdentifierEas,
  peppolIdentifierAddress,
  documentTypeCode,
  useTestNetwork,
}:{
  peppolIdentifierEas: string,
  peppolIdentifierAddress: string,
  documentTypeCode: string,
  useTestNetwork: boolean,
}) {
  const serviceGroupId = `${peppolIdentifierEas}:${peppolIdentifierAddress}`;
  const documentTypeId = `${DOCUMENT_SCHEME}::${documentTypeCode}`;
  const encodedDocumentTypeId = encodeURIComponent(documentTypeId);

  const response = await fetchSmp(
    `${PARTICIPANT_SCHEME}::${serviceGroupId}/services/${encodedDocumentTypeId}`,
    {
      method: "DELETE",
      useTestNetwork,
    }
  );

  if (!response.ok) {
    throw new UserFacingError("Failed to delete service metadata in SMP");
  }

  return true;
}