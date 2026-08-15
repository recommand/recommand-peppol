import { describe, expect, it } from "bun:test";
import {
  extractFacturXDocument,
  generateFacturXDocument,
} from "../data/factur-x/client";
import { invoiceToCII } from "../utils/parsing/invoice/cii-d22b/to-xml";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function parseXml(xml: string): unknown {
  return xmlParser.parse(xml.trim());
}

const sampleInvoice: Invoice = {
  invoiceNumber: "FACTUR-X-TEST-001",
  issueDate: "2026-01-01",
  dueDate: "2026-01-31",
  currency: "EUR",
  buyerReference: "BUYER-REF",
  seller: {
    name: "Seller SAS",
    street: "1 Rue Seller",
    city: "Paris",
    postalZone: "75001",
    country: "FR",
    vatNumber: "FR40303265045",
    street2: null,
  },
  buyer: {
    name: "Buyer SAS",
    street: "2 Rue Buyer",
    city: "Lyon",
    postalZone: "69001",
    country: "FR",
    vatNumber: "FR23341815675",
    street2: null,
  },
  lines: [
    {
      name: "Service",
      quantity: "1",
      unitCode: "C62",
      netPriceAmount: "100.00",
      netAmount: null,
      vat: { category: "S", percentage: "20.00" },
    },
  ],
};

const sampleXmlDocument = invoiceToCII({
  invoice: sampleInvoice,
  senderAddress: "0225:133512194",
  recipientAddress: "0225:133512194",
  isDocumentValidationEnforced: false,
  profile: {
    customizationId: "urn:cen.eu:en16931:2017",
    processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
  },
});

const samplePdf = Buffer.from(
  `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 36 120 Td (Factur-X test) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000204 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
298
%%EOF`
);

describe("Factur-X client", () => {
  it("extracts the original XML from a generated Factur-X PDF", async () => {
    const facturXDocument = await generateFacturXDocument({
      xmlDocument: sampleXmlDocument,
      pdf: {
        filename: "factur-x-test.pdf",
        mimeCode: "application/pdf",
        content: samplePdf,
      },
    });

    expect(Buffer.isBuffer(facturXDocument)).toBe(true);
    expect(facturXDocument.subarray(0, 4).toString("ascii")).toBe("%PDF");

    const extracted = await extractFacturXDocument({
      pdf: {
        filename: "factur-x-test.pdf",
        mimeCode: "application/pdf",
        content: facturXDocument,
      },
    });

    expect(parseXml(extracted.xmlDocument)).toEqual(
      parseXml(sampleXmlDocument)
    );
  });

  it("throws service errors for invalid PDFs", async () => {
    await expect(
      extractFacturXDocument({
        pdf: {
          filename: "invalid.pdf",
          mimeCode: "application/pdf",
          content: Buffer.from("not a pdf"),
        },
      })
    ).rejects.toThrow("Failed to extract Factur-X document.");
  });
});
