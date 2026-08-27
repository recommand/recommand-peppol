import { describe, expect, test } from "bun:test";
import {
  buildStandardBusinessDocument,
  extractStandardBusinessDocumentPayload,
  parseSbdhDocumentIdentification,
} from "@peppol/utils/sbdh";

const BIS_BILLING_INVOICE_DOC_TYPE_ID =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const FACTURX_DOC_TYPE_ID =
  "urn:peppol:doctype:pdf+xml##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:Factur-X:1.0::D22B";

describe("parseSbdhDocumentIdentification", () => {
  test("parses a UBL document type identifier", () => {
    expect(
      parseSbdhDocumentIdentification(BIS_BILLING_INVOICE_DOC_TYPE_ID)
    ).toEqual({
      standard: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      type: "Invoice",
      typeVersion: "2.1",
    });
  });

  test("uses the Peppol France profile values for Factur-X", () => {
    expect(parseSbdhDocumentIdentification(FACTURX_DOC_TYPE_ID)).toEqual({
      standard: "urn:peppol:doctype:pdf+xml",
      type: "Invoice",
      typeVersion: "0",
    });
  });

  test("returns null for unparseable identifiers", () => {
    expect(parseSbdhDocumentIdentification("not-a-doc-type")).toBeNull();
  });
});

describe("buildStandardBusinessDocument", () => {
  const baseOptions = {
    senderId: "0208:0000000001",
    receiverId: "0007:2120000787",
    docTypeId: BIS_BILLING_INVOICE_DOC_TYPE_ID,
    processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
    countryC1: "BE",
    documentIdScheme: "busdox-docid-qns",
    processIdScheme: "cenbii-procid-ubl",
  };

  test("wraps an XML document, stripping its XML declaration", () => {
    const { xml, instanceIdentifier } = buildStandardBusinessDocument({
      ...baseOptions,
      payload: {
        kind: "xml",
        xml: '<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID>1</cbc:ID></Invoice>',
      },
    });

    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<StandardBusinessDocument xmlns="http://www.unece.org/cefact/namespaces/StandardBusinessDocumentHeader">'
    );
    expect(xml).toContain(
      '<Identifier Authority="iso6523-actorid-upis">0208:0000000001</Identifier>'
    );
    expect(xml).toContain(
      '<Identifier Authority="iso6523-actorid-upis">0007:2120000787</Identifier>'
    );
    expect(xml).toContain(
      "<Standard>urn:oasis:names:specification:ubl:schema:xsd:Invoice-2</Standard>"
    );
    expect(xml).toContain("<TypeVersion>2.1</TypeVersion>");
    expect(xml).toContain("<Type>Invoice</Type>");
    expect(xml).toContain(`<InstanceIdentifier>${instanceIdentifier}</InstanceIdentifier>`);
    expect(xml).toContain(`<InstanceIdentifier>${baseOptions.docTypeId}</InstanceIdentifier>`);
    expect(xml).toContain("<Identifier>busdox-docid-qns</Identifier>");
    expect(xml).toContain(`<InstanceIdentifier>${baseOptions.processId}</InstanceIdentifier>`);
    expect(xml).toContain("<Identifier>cenbii-procid-ubl</Identifier>");
    expect(xml).toContain("<InstanceIdentifier>BE</InstanceIdentifier>");
    // The declaration of the wrapped document must not appear mid-document
    expect(xml.lastIndexOf("<?xml")).toBe(0);
    expect(xml).toContain("<cbc:ID>1</cbc:ID></Invoice>");
    expect(xml).toEndWith("</StandardBusinessDocument>");
  });

  test("wraps a binary payload as Peppol BinaryContent", () => {
    const { xml } = buildStandardBusinessDocument({
      ...baseOptions,
      docTypeId: FACTURX_DOC_TYPE_ID,
      processId: "urn:peppol:france:billing:regulated",
      countryC1: "FR",
      payload: {
        kind: "binary",
        base64Content: "JVBERi0=",
        mimeType: "application/pdf",
      },
    });

    expect(xml).toContain("<Standard>urn:peppol:doctype:pdf+xml</Standard>");
    expect(xml).toContain("<TypeVersion>0</TypeVersion>");
    expect(xml).toContain("<Type>Invoice</Type>");
    expect(xml).toContain(
      '<BinaryContent xmlns="http://peppol.eu/xsd/ticc/envelope/1.0" mimeType="application/pdf">JVBERi0=</BinaryContent>'
    );
  });

  test("escapes XML special characters in header values", () => {
    const { xml } = buildStandardBusinessDocument({
      ...baseOptions,
      senderId: '0208:a&b<c>"d',
      payload: { kind: "xml", xml: "<Invoice/>" },
    });

    expect(xml).toContain(
      '<Identifier Authority="iso6523-actorid-upis">0208:a&amp;b&lt;c&gt;&quot;d</Identifier>'
    );
  });

  test("throws on document types it cannot derive identification from", () => {
    expect(() =>
      buildStandardBusinessDocument({
        ...baseOptions,
        docTypeId: "gibberish",
        payload: { kind: "xml", xml: "<Invoice/>" },
      })
    ).toThrow();
  });

  test("extract round-trips an XML payload", () => {
    const invoice =
      '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID>1</cbc:ID></Invoice>';
    const { xml } = buildStandardBusinessDocument({
      ...baseOptions,
      payload: { kind: "xml", xml: invoice },
    });

    expect(extractStandardBusinessDocumentPayload(xml)).toEqual({
      kind: "xml",
      xml: invoice,
    });
  });

  test("extract round-trips a binary payload", () => {
    const { xml } = buildStandardBusinessDocument({
      ...baseOptions,
      docTypeId: FACTURX_DOC_TYPE_ID,
      payload: {
        kind: "binary",
        base64Content: Buffer.from("%PDF-fake").toString("base64"),
        mimeType: "application/pdf",
      },
    });

    const extracted = extractStandardBusinessDocumentPayload(xml);
    expect(extracted.kind).toBe("binary");
    if (extracted.kind === "binary") {
      expect(extracted.mimeType).toBe("application/pdf");
      expect(extracted.content.toString()).toBe("%PDF-fake");
    }
  });

  test("extract handles namespace-prefixed SBD elements", () => {
    const xml = [
      '<sh:StandardBusinessDocument xmlns:sh="http://www.unece.org/cefact/namespaces/StandardBusinessDocumentHeader">',
      "<sh:StandardBusinessDocumentHeader><sh:HeaderVersion>1.0</sh:HeaderVersion></sh:StandardBusinessDocumentHeader>",
      '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
      "</sh:StandardBusinessDocument>",
    ].join("\n");

    expect(extractStandardBusinessDocumentPayload(xml)).toEqual({
      kind: "xml",
      xml: '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
    });
  });

  test("extract returns non-SBD input unchanged", () => {
    const invoice = "<Invoice><cbc:ID>1</cbc:ID></Invoice>";
    expect(extractStandardBusinessDocumentPayload(invoice)).toEqual({
      kind: "xml",
      xml: invoice,
    });
  });
});
