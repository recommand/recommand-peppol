import { fetchSmp } from "./client";
import { XMLBuilder } from "fast-xml-parser";
import { PARTICIPANT_SCHEME } from "./service-metadata";
import { UserFacingError } from "@peppol/utils/util";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

export async function registerBusinessCard({
  peppolIdentifierEas,
  peppolIdentifierAddress,
  name,
  countryCode,
  geographicalInformation,
  vatNumber,
  useTestNetwork,
}:{
  peppolIdentifierEas: string;
  peppolIdentifierAddress: string;
  name: string;
  countryCode: string;
  geographicalInformation: string;
  vatNumber?: string | null;
  useTestNetwork: boolean;
}) {
  const serviceGroupId = `${peppolIdentifierEas}:${peppolIdentifierAddress}`;

  // Create the business card XML according to the Peppol Directory specification
  const businessCardXml = {
    "BusinessCard": {
      "@_xmlns": "http://www.peppol.eu/schema/pd/businesscard/20180621/",
      "ParticipantIdentifier": {
        "@_scheme": PARTICIPANT_SCHEME,
        "#text": serviceGroupId
      },
      "BusinessEntity": {
        "Name": {
          "@_language": "en",
          "#text": name
        },
        "CountryCode": countryCode,
        "GeographicalInformation": geographicalInformation,
        ...(vatNumber && {
          "Identifier": {
            "@_scheme": "VAT",
            "#text": vatNumber
          }
        })
      }
    }
  };

  const response = await fetchSmp(
    `businesscard/${PARTICIPANT_SCHEME}::${serviceGroupId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/xml"
      },
      body: builder.build(businessCardXml),
      useTestNetwork,
    }
  );

  if (!response.ok) {
    console.error(await response.text());
    throw new UserFacingError("Failed to register business card in SMP");
  }

  return true;
}