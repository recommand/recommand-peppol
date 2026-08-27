import { UserFacingError } from "@peppol/utils/util";
import { fetchSmp } from "./client";
import { XMLBuilder } from "fast-xml-parser";

const SCHEME = "iso6523-actorid-upis";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

export async function registerServiceGroup({
  peppolIdentifierEas,
  peppolIdentifierAddress,
  useTestNetwork,
}:{
  peppolIdentifierEas: string;
  peppolIdentifierAddress: string;
  useTestNetwork: boolean;
}) {
  const serviceGroupId = `${peppolIdentifierEas}:${peppolIdentifierAddress}`;
  
  // Create the XML body according to the Peppol style
  const serviceGroupXml = {
    "smp:ServiceGroup": {
      "@_xmlns:smp": "http://busdox.org/serviceMetadata/publishing/1.0/",
      "@_xmlns:id": "http://busdox.org/transport/identifiers/1.0/",
      "id:ParticipantIdentifier": {
        "@_scheme": SCHEME,
        "#text": serviceGroupId
      },
      "smp:ServiceMetadataReferenceCollection": {}
    }
  };

  const response = await fetchSmp(
    `${SCHEME}::${serviceGroupId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/xml"
      },
      body: builder.build(serviceGroupXml),
      useTestNetwork,
    }
  );

  if (!response.ok) {
    console.error(await response.text());
    throw new UserFacingError("Failed to register service group in SMP");
  }

  const data = await response.json();
  return data;
}

export async function deleteServiceGroup({
  peppolIdentifierEas,
  peppolIdentifierAddress,
  useTestNetwork,
}:{
  peppolIdentifierEas: string;
  peppolIdentifierAddress: string;
  useTestNetwork: boolean;
}) {
  const serviceGroupId = `${peppolIdentifierEas}:${peppolIdentifierAddress}`;
  
  const response = await fetchSmp(
    `${SCHEME}::${serviceGroupId}`,
    {
      method: "DELETE",
      useTestNetwork,
    }
  );

  if (!response.ok) {
    const responseText = await response.text();
    console.error("Failed to delete service group in SMP");
    console.error(responseText);

    if(responseText.includes("does not exist")){
      return true;
    }

    throw new UserFacingError("Failed to delete service group in SMP");
  }

  return true;
}
