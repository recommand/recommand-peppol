/**
 * A raw XML document sent under a process it does not belong to.
 *
 * The process a caller names for raw XML goes into the envelope, while the
 * document names its own process in its profile identifier. A send is refused
 * only when the two plainly name different Peppol BIS processes; anything less
 * certain is sent as it was before.
 */

import { describe, expect, it, spyOn } from "bun:test";
import { invoiceDocument, frenchInvoiceDocument } from "./e2e/documents";
import { SendingFailure } from "../utils/pipelines/sending/errors";
import { prepareJsonDocument } from "../utils/pipelines/sending/prepare-json-document";
import { prepareXmlDocument } from "../utils/pipelines/sending/prepare-xml-document";
import { sendDocumentSchema } from "../utils/parsing/send-document";
import * as xmlDetection from "../utils/type-repository/document-formats/xml-detection";

const BILLING = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const SELF_BILLING = "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0";
const MLR = "urn:fdc:peppol.eu:poacc:bis:mlr:3";
const FRANCE_REGULATED = "urn:peppol:france:billing:regulated";
const FRANCE_NON_REGULATED = "urn:peppol:france:billing:non-regulated";

const BIS3_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const SELF_BILLING_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0";
const MLR_CUSTOMIZATION_ID = "urn:fdc:peppol.eu:poacc:trns:mlr:3";
const INVOICE_RESPONSE_CUSTOMIZATION_ID = "urn:fdc:peppol.eu:poacc:trns:invoice_response:3";
const INVOICE_RESPONSE = "urn:fdc:peppol.eu:poacc:bis:invoice_response:3";
const BILLING_WITH_RESPONSE = "urn:peppol:bis:billing_with_response";

function ublInvoice(profile: string | null, customizationId = BIS3_CUSTOMIZATION_ID): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${customizationId}</cbc:CustomizationID>
${profile === null ? "" : `  <cbc:ProfileID>${profile}</cbc:ProfileID>\n`}  <cbc:ID>PROCESS-1</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
</Invoice>`;
}

function messageLevelResponse(profile: string, customizationId = MLR_CUSTOMIZATION_ID): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${customizationId}</cbc:CustomizationID>
  <cbc:ProfileID>${profile}</cbc:ProfileID>
  <cbc:ID>PROCESS-2</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
</ApplicationResponse>`;
}

function ciiInvoice(businessProcess: string | null, guidelineId = BIS3_CUSTOMIZATION_ID): string {
  const businessProcessParameter =
    businessProcess === null
      ? ""
      : `    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>${businessProcess}</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocumentContext>
${businessProcessParameter}    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${guidelineId}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
</rsm:CrossIndustryInvoice>`;
}

/** No registered format reads every CII here, so the doc type is named rather than detected. */
function prepareCii(
  businessProcess: string | null,
  extra: Record<string, unknown>,
  guidelineId = BIS3_CUSTOMIZATION_ID,
) {
  return prepare(ciiInvoice(businessProcess, guidelineId), {
    doctypeId: `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##${guidelineId}::D22B`,
    ...extra,
  });
}

function prepare(document: string, extra: Record<string, unknown> = {}) {
  return prepareXmlDocument(
    sendDocumentSchema.parse({
      recipient: "0208:0795374462",
      documentType: "xml",
      document,
      ...extra,
    }),
  );
}

describe("raw XML sent under another process than it declares", () => {
  it("is refused when the profile names another Peppol BIS process", () => {
    expect(() => prepare(ublInvoice(BILLING), { processId: SELF_BILLING })).toThrow(SendingFailure);
    expect(() => prepare(ublInvoice(BILLING), { processId: SELF_BILLING })).toThrow(
      `The processId '${SELF_BILLING}' does not match the process the XML document declares in cbc:ProfileID: '${BILLING}'. ` +
        `Send the document with processId '${BILLING}', or correct cbc:ProfileID if the document belongs to '${SELF_BILLING}'.`,
    );
    expect(() => prepare(ublInvoice(SELF_BILLING, SELF_BILLING_CUSTOMIZATION_ID), { processId: BILLING })).toThrow(
      SendingFailure,
    );
    expect(() => prepare(messageLevelResponse(MLR), { processId: BILLING })).toThrow(SendingFailure);
    expect(() =>
      prepare(messageLevelResponse(INVOICE_RESPONSE, INVOICE_RESPONSE_CUSTOMIZATION_ID), { processId: MLR }),
    ).toThrow(SendingFailure);
  });

  it("is refused with status 400", () => {
    try {
      prepare(messageLevelResponse(MLR), { processId: BILLING });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(SendingFailure);
      expect((error as SendingFailure).status).toBe(400);
    }
  });

  it("reads the CII business process the same way", () => {
    expect(() => prepareCii(BILLING, { processId: MLR })).toThrow(
      "declares in ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'",
    );
  });

  it("is refused whatever the requested doc type, which does not change the process", () => {
    const doctypeId = `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${BIS3_CUSTOMIZATION_ID}::2.1`;
    expect(() => prepare(ublInvoice(BILLING), { doctypeId, processId: SELF_BILLING })).toThrow(SendingFailure);
  });

  it("is still refused when the process comes with its scheme in front of it", () => {
    expect(() => prepare(ublInvoice(BILLING), { processId: `cenbii-procid-ubl::${SELF_BILLING}` })).toThrow(
      SendingFailure,
    );
  });
});

describe("raw XML that is sent as before", () => {
  it("passes when the process is the one the document declares", () => {
    expect(prepare(ublInvoice(BILLING), { processId: BILLING }).processId).toBe(BILLING);
    expect(prepare(messageLevelResponse(MLR), { processId: MLR }).processId).toBe(MLR);
    expect(prepareCii(BILLING, { processId: BILLING }).processId).toBe(BILLING);
  });

  it("passes another spelling of the same identifier", () => {
    expect(prepare(ublInvoice(BILLING), { processId: `cenbii-procid-ubl::${BILLING}` }).processId).toBe(BILLING);
    expect(prepare(ublInvoice(BILLING), { processId: `cenbii-procid-ucs::${BILLING}` }).processId).toBe(
      `cenbii-procid-ucs::${BILLING}`,
    );
    expect(prepare(ublInvoice(BILLING.toUpperCase()), { processId: BILLING }).processId).toBe(BILLING);
    expect(prepare(ublInvoice(BILLING.toUpperCase()), { processId: SELF_BILLING }).processId).toBe(SELF_BILLING);
    expect(prepare(ublInvoice(BILLING), { processId: SELF_BILLING.toUpperCase() }).processId).toBe(
      SELF_BILLING.toUpperCase(),
    );
    expect(prepare(ublInvoice(`\n    ${BILLING}\n  `), { processId: BILLING }).processId).toBe(BILLING);
    expect(prepare(ublInvoice(BILLING), { processId: ` ${BILLING} ` }).processId).toBe(` ${BILLING} `);
  });

  it("passes a Peppol BIS document over a French process", () => {
    // Peppol BIS Billing 3.0 always names its own process in BT-23, and France
    // carries it over its own processes.
    expect(prepare(ublInvoice(BILLING), { processId: FRANCE_REGULATED }).processId).toBe(FRANCE_REGULATED);
    expect(prepare(ublInvoice(BILLING), { processId: FRANCE_NON_REGULATED }).processId).toBe(FRANCE_NON_REGULATED);
    expect(prepareCii(BILLING, { processId: FRANCE_REGULATED }).processId).toBe(FRANCE_REGULATED);
  });

  it("passes a document of another specification, whose profile is not the Peppol BIS process", () => {
    // National CIUSes, generic EN 16931 and the French profiles set BT-23 by their own rules.
    for (const customizationId of [
      "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
      "urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0",
      "urn:cen.eu:en16931:2017",
      "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0",
      "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0#conformant#urn:some:extension",
    ]) {
      expect(prepare(ublInvoice(SELF_BILLING, customizationId), { processId: BILLING }).processId).toBe(BILLING);
      expect(prepareCii(SELF_BILLING, { processId: BILLING }, customizationId).processId).toBe(BILLING);
    }
    // A UBL document that names no specification at all.
    const unnamed = ublInvoice(SELF_BILLING).replace(/\s*<cbc:CustomizationID>.*<\/cbc:CustomizationID>/, "");
    expect(prepare(unnamed, { processId: BILLING }).processId).toBe(BILLING);
  });

  it("passes Billing with Response, which carries Peppol BIS Billing documents too", () => {
    expect(prepare(ublInvoice(BILLING), { processId: BILLING_WITH_RESPONSE }).processId).toBe(BILLING_WITH_RESPONSE);
    expect(prepare(ublInvoice(BILLING_WITH_RESPONSE), { processId: BILLING }).processId).toBe(BILLING);
    expect(
      prepare(messageLevelResponse(BILLING_WITH_RESPONSE, INVOICE_RESPONSE_CUSTOMIZATION_ID), {
        processId: INVOICE_RESPONSE,
      }).processId,
    ).toBe(INVOICE_RESPONSE);
    expect(
      prepare(messageLevelResponse(INVOICE_RESPONSE, INVOICE_RESPONSE_CUSTOMIZATION_ID), {
        processId: BILLING_WITH_RESPONSE,
      }).processId,
    ).toBe(BILLING_WITH_RESPONSE);
  });

  it("passes an invoice response over a French process", () => {
    expect(
      prepare(messageLevelResponse(INVOICE_RESPONSE, INVOICE_RESPONSE_CUSTOMIZATION_ID), {
        processId: FRANCE_REGULATED,
      }).processId,
    ).toBe(FRANCE_REGULATED);
  });

  it("passes a French document whose profile is a billing framework code", () => {
    for (const billingMode of ["S1", "B1", "M1"]) {
      expect(prepare(ublInvoice(billingMode, "urn:cen.eu:en16931:2017"), { processId: FRANCE_REGULATED }).processId).toBe(
        FRANCE_REGULATED,
      );
      expect(prepareCii(billingMode, { processId: FRANCE_REGULATED }, "urn:cen.eu:en16931:2017").processId).toBe(
        FRANCE_REGULATED,
      );
      // Not a process identifier at all, so there is nothing to contradict.
      expect(prepare(ublInvoice(billingMode), { processId: BILLING }).processId).toBe(BILLING);
    }
  });

  it("passes a document that declares no profile, an empty one or more than one", () => {
    expect(prepare(ublInvoice(null), { processId: SELF_BILLING }).processId).toBe(SELF_BILLING);
    expect(prepare(ublInvoice(""), { processId: SELF_BILLING }).processId).toBe(SELF_BILLING);
    expect(prepareCii(null, { processId: MLR }).processId).toBe(MLR);
    const twice = ublInvoice(BILLING).replace(
      "<cbc:ID>",
      `<cbc:ProfileID>${BILLING}</cbc:ProfileID>\n  <cbc:ID>`,
    );
    expect(prepare(twice, { processId: SELF_BILLING }).processId).toBe(SELF_BILLING);
  });

  it("passes a process or a profile this check does not know", () => {
    // A process from another specification, another version, or a national one.
    for (const processId of [
      "urn:www.cenbii.eu:profile:bii05:ver2.0",
      "urn:fdc:peppol.eu:2017:poacc:billing:01:1.1",
      "urn:fdc:peppol.eu:2017:poacc:billing:02:1.0",
      "urn:some:national:process",
    ]) {
      expect(prepare(ublInvoice(BILLING), { processId }).processId).toBe(processId);
      expect(prepare(ublInvoice(processId), { processId: BILLING }).processId).toBe(BILLING);
    }
  });

  it("passes a document that cannot be parsed, which is refused for its doc type as before", () => {
    const doctypeId = `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${BIS3_CUSTOMIZATION_ID}::2.1`;
    expect(prepare("<Invoice><cbc:ProfileID>", { doctypeId, processId: SELF_BILLING }).processId).toBe(SELF_BILLING);
    expect(() => prepare("not xml", { processId: SELF_BILLING })).toThrow(
      "Document type could not be detected automatically from your XML document. Please provide the doctypeId manually.",
    );
  });

  it("still derives the process when the caller names none", () => {
    // The check only compares a process the caller supplied; a derived one is
    // left as it was, even where it is not the document's own: this self-billing
    // invoice declares the billing process, and goes out over self-billing.
    expect(prepare(messageLevelResponse(MLR)).processId).toBe(MLR);
    expect(prepare(ublInvoice(BILLING, SELF_BILLING_CUSTOMIZATION_ID)).processId).toBe(SELF_BILLING);
  });

  it("passes a document the check itself fails on", () => {
    const parse = spyOn(xmlDetection, "parseXmlForDetection").mockImplementation(() => {
      throw new Error("unexpected");
    });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      // Refused when the check works, see above; the doc type is named, so
      // nothing else reads the document through the failing parser.
      const doctypeId = `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${BIS3_CUSTOMIZATION_ID}::2.1`;
      expect(prepare(ublInvoice(BILLING), { doctypeId, processId: SELF_BILLING }).processId).toBe(SELF_BILLING);
      expect(parse).toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(
        "Failed to compare the process id with the XML document:",
        expect.any(Error),
      );
    } finally {
      parse.mockRestore();
      logged.mockRestore();
    }
  });
});

describe("JSON documents", () => {
  const company = (country: "BE" | "FR") =>
    ({
      id: `c_${country.toLowerCase()}`,
      name: "Process Test",
      address: "Teststraat 1",
      postalCode: "1000",
      city: "Brussels",
      country,
      vatNumber: country === "BE" ? "BE1234567894" : "FR40303265045",
      enterpriseNumber: null,
      enterpriseNumberScheme: null,
      email: null,
      phone: null,
      accessPointProvider: country === "BE" ? "recommand-ap1" : "at-shared-ap-fr",
    }) as any;

  async function prepareJson(country: "BE" | "FR", document: unknown, processId: string) {
    return prepareJsonDocument({
      input: { documentType: "invoice", recipient: "0208:0795374462", document, processId } as any,
      company: company(country),
      senderAddress: country === "BE" ? "0208:1234567894" : "0009:30326504500017",
      recipientAddress: "0208:0795374462",
      documentId: "doc_process_check",
      isPlayground: false,
      recipientCapabilities: null,
    });
  }

  it("are written and sent under the requested process as before", async () => {
    const belgian = await prepareJson("BE", invoiceDocument(), BILLING);
    expect(belgian.processId).toBe(BILLING);
    expect(belgian.xml).toContain(`<cbc:ProfileID>${BILLING}</cbc:ProfileID>`);

    // The BIS document names its own process in BT-23 while it travels over the
    // French one, a pairing raw XML is allowed as well.
    const french = await prepareJson("FR", frenchInvoiceDocument(), FRANCE_REGULATED);
    expect(french.processId).toBe(FRANCE_REGULATED);
    expect(french.xml).toContain(`<cbc:ProfileID>${BILLING}</cbc:ProfileID>`);
    expect(prepare(french.xml, { processId: FRANCE_REGULATED }).processId).toBe(FRANCE_REGULATED);
  });
});
