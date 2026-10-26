import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  DOCUMENT_SCHEME,
  PARTICIPANT_SCHEME,
} from "../data/phoss-smp/service-metadata";

// Spied on rather than replaced as a module: a module mock lasts for the whole test run
// and would hand its stand-in to the files that test the real lookups.
const naptr = await import("../utils/naptr");
const naptrSpy = spyOn(naptr, "resolveNaptr").mockResolvedValue({ status: "found", smpUrl: "https://smp.example" });

const { SmpLookupError, verifyDocumentSupport } = await import("../data/recipient");

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

// `mockReset` only clears the implementation: it leaves a stub in place of the
// global that returns undefined, for the rest of the process. Bun runs every
// test file in one process, so without this the files that come after this one
// — the end-to-end suite among them, which then cannot reach the server at all
// — are left with a `fetch` that answers nothing.
afterAll(() => {
  fetchMock.mockRestore();
  naptrSpy.mockRestore();
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

// The SMP's answer that it has no such registration is told apart from no usable answer,
// which says nothing about the registration.
describe("verifyDocumentSupport when the SMP does not give the registration", () => {
  const verify = () =>
    verifyDocumentSupport({ recipientAddress: "0208:0123456789", documentType: "invoice", useTestNetwork: true });

  function answer(response: () => Promise<Response>): void {
    fetchMock.mockImplementation(Object.assign(response, { preconnect: globalThis.fetch.preconnect }));
  }

  it("finds no endpoint when the SMP answers 404", async () => {
    answer(async () => new Response("", { status: 404 }));
    const error = await verify().catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(SmpLookupError);
    expect((error as Error).message).toContain("no endpoint found");
  });

  it("finds no endpoint when the registration lacks the process", async () => {
    answer(async () => new Response(serviceMetadata));
    const error = await verifyDocumentSupport({
      recipientAddress: "0208:0123456789",
      documentType: "invoice",
      processId: "urn:other:process",
      useTestNetwork: true,
    }).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(SmpLookupError);
    expect((error as Error).message).toContain("no endpoint found");
  });

  it("throws SmpLookupError when the SMP answers with another error status", async () => {
    for (const status of [500, 503, 403]) {
      answer(async () => new Response("", { status }));
      await expect(verify()).rejects.toBeInstanceOf(SmpLookupError);
    }
  });

  it("throws SmpLookupError when the request fails or times out", async () => {
    answer(async () => {
      throw new TypeError("connection reset");
    });
    await expect(verify()).rejects.toBeInstanceOf(SmpLookupError);

    answer(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(verify()).rejects.toThrow("did not answer in time");
  });

  it("throws SmpLookupError when the SMP answers 200 with something other than service metadata", async () => {
    for (const body of ["<html><body>Down for maintenance</body></html>", "", "garbage"]) {
      answer(async () => new Response(body));
      await expect(verify()).rejects.toThrow("not service metadata");
    }
  });

  it("gives the SMP ten seconds", async () => {
    const timeoutSpy = spyOn(AbortSignal, "timeout");
    try {
      answer(async () => new Response(serviceMetadata));
      await verify();
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal).toBe(timeoutSpy.mock.results[0]?.value as AbortSignal);
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});
