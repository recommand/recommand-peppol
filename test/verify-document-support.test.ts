import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  DOCUMENT_SCHEME,
  PARTICIPANT_SCHEME,
} from "../data/phoss-smp/service-metadata";

mock.module("@peppol/utils/naptr", () => ({
  resolveNaptr: async () => "https://smp.example",
}));

const { verifyDocumentSupport } = await import("../data/recipient");

const serviceMetadata = `
  <ServiceMetadata>
    <ServiceInformation>
      <ProcessList>
        <Process>
          <ProcessIdentifier>urn:test:process</ProcessIdentifier>
          <ServiceEndpointList>
            <Endpoint>
              <EndpointReference>
                <Address>https://ap.example/as4</Address>
              </EndpointReference>
              <ServiceDescription>Test AP</ServiceDescription>
              <TechnicalContactUrl>mailto:support@example.com</TechnicalContactUrl>
            </Endpoint>
          </ServiceEndpointList>
        </Process>
      </ProcessList>
    </ServiceInformation>
  </ServiceMetadata>
`;

const documentTypes = [
  [
    "invoice",
    "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  ],
  [
    "creditNote",
    "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  ],
  [
    "selfBillingInvoice",
    "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1",
  ],
  [
    "selfBillingCreditNote",
    "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1",
  ],
  [
    "messageLevelResponse",
    "urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2::ApplicationResponse##urn:fdc:peppol.eu:poacc:trns:mlr:3::2.1",
  ],
  [
    "frenchInvoicingCdar",
    "urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100::CrossDomainAcknowledgementAndResponse##urn:peppol:france:billing:cdv:1.0::D22B",
  ],
  [
    "invoiceResponse",
    "urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2::ApplicationResponse##urn:fdc:peppol.eu:poacc:trns:invoice_response:3::2.1",
  ],
] as const;

const fetchMock = spyOn(globalThis, "fetch");

function mockServiceMetadataFetch(requestedUrls: string[]): void {
  fetchMock.mockImplementation(
    Object.assign(
      async (input: URL | RequestInfo) => {
        requestedUrls.push(String(input));
        return new Response(serviceMetadata);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("verifyDocumentSupport", () => {
  for (const [documentType, expectedDocTypeId] of documentTypes) {
    it(`resolves ${documentType} to its SMP document type ID`, async () => {
      const requestedUrls: string[] = [];
      mockServiceMetadataFetch(requestedUrls);

      const result = await verifyDocumentSupport({
        recipientAddress: "0208:0123456789",
        documentType,
        useTestNetwork: true,
      });

      expect(requestedUrls).toEqual([
        `https://smp.example/${PARTICIPANT_SCHEME}::0208%3A0123456789/services/${DOCUMENT_SCHEME}::${encodeURIComponent(expectedDocTypeId)}`,
      ]);
      expect(result.endpointDetails.serviceEndpoint).toBe(
        "https://ap.example/as4",
      );
    });
  }

  it("uses a full document type ID unchanged", async () => {
    const documentType = "urn:example:custom-document:1";
    const requestedUrls: string[] = [];
    mockServiceMetadataFetch(requestedUrls);

    await verifyDocumentSupport({
      recipientAddress: "0208:0123456789",
      documentType,
      useTestNetwork: false,
    });

    expect(requestedUrls[0]).toEndWith(
      `/services/${DOCUMENT_SCHEME}::${encodeURIComponent(documentType)}`,
    );
  });
});
