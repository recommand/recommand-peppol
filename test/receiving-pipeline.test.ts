import { describe, expect, it } from "bun:test";
import type { Company } from "@peppol/data/companies";
import { prepareIncomingDocument } from "@peppol/utils/pipelines/receiving/prepare-document";
import { peppolUblMlrFormat } from "@peppol/utils/type-repository/document-formats/peppol-ubl-mlr";
import { siUblInvoiceFormat } from "@peppol/utils/type-repository/document-formats/si-ubl-invoice";
import { siUblCreditnoteFormat } from "@peppol/utils/type-repository/document-formats/si-ubl-creditnote";
import { invoiceXmlDocument } from "./e2e/documents";

const company = { name: "Receiver" } as Company;
const processId = peppolUblMlrFormat.supportedProcessIds[0];
const xml = peppolUblMlrFormat.encode(
  {
    id: "response-1",
    issueDate: "2026-08-12",
    responseCode: "AP",
    envelopeId: "envelope-1",
  },
  processId,
  {
    senderAddress: "0208:0123456789",
    recipientAddress: "0208:9876543210",
    isDocumentValidationEnforced: true,
  },
);

function receive(options: {
  docTypeId: string;
  body?: BodyInit;
  contentType?: string;
}) {
  return prepareIncomingDocument({
    body: options.body ?? xml,
    contentType: options.contentType ?? "application/xml",
    docTypeId: options.docTypeId,
    processId,
    company,
    senderId: "0208:0123456789",
  });
}

describe("receiving pipeline", () => {
  it("decodes a document from its document type identifier", async () => {
    const received = await receive({
      docTypeId: peppolUblMlrFormat.docTypeId,
    });

    expect(received.type).toBe("messageLevelResponse");
    expect(received.probableType).toBe("messageLevelResponse");
    expect(received.parsedDocument).toEqual({
      id: "response-1",
      issueDate: "2026-08-12",
      responseCode: "AP",
      envelopeId: "envelope-1",
    });
    expect(received.xmlDocument).toBe(xml);
    expect(received.originalPayload).toBeNull();
  });

  it("detects the format from XML when the identifier is not registered", async () => {
    const received = await receive({ docTypeId: "unregistered" });

    expect(received.type).toBe("messageLevelResponse");
    expect(received.parsedDocument.id).toBe("response-1");
  });

  it("keeps an unsupported XML document as unknown", async () => {
    const received = await receive({
      docTypeId: "unregistered",
      body: "<Unsupported />",
    });

    expect(received.type).toBe("unknown");
    expect(received.probableType).toBe("unknown");
    expect(received.parsedDocument).toBeNull();
  });

  it("receives SI-UBL invoices through the registered UBL codec", async () => {
    const siUblXml = invoiceXmlDocument().replace(
      "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
      "urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0",
    );
    const received = await receive({
      docTypeId: siUblInvoiceFormat.docTypeId,
      body: siUblXml,
    });

    expect(received.type).toBe("invoice");
    expect(received.parsedDocument.invoiceNumber).toStartWith("E2E-XML");

    const encoded = siUblInvoiceFormat.encode(
      received.parsedDocument,
      siUblInvoiceFormat.supportedProcessIds[0],
      {
        senderAddress: "0208:0123456789",
        recipientAddress: "0106:123456",
        isDocumentValidationEnforced: true,
      },
    );
    expect(encoded).toContain(
      "<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0</cbc:CustomizationID>",
    );
  });

  it("encodes SI-UBL credit notes with the SI-UBL profile", async () => {
    const siUblCreditNoteXml = invoiceXmlDocument()
      .replaceAll("Invoice-2", "CreditNote-2")
      .replaceAll("<Invoice ", "<CreditNote ")
      .replaceAll("</Invoice>", "</CreditNote>")
      .replaceAll("InvoiceTypeCode", "CreditNoteTypeCode")
      .replaceAll(">380<", ">381<")
      .replaceAll("InvoiceLine", "CreditNoteLine")
      .replaceAll("InvoicedQuantity", "CreditedQuantity")
      .replace(
        "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
        "urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0",
      );
    const received = await receive({
      docTypeId: siUblCreditnoteFormat.docTypeId,
      body: siUblCreditNoteXml,
    });

    expect(received.type).toBe("creditNote");
    const encoded = siUblCreditnoteFormat.encode(
      received.parsedDocument,
      siUblCreditnoteFormat.supportedProcessIds[0],
      {
        senderAddress: "0208:0123456789",
        recipientAddress: "0106:123456",
        isDocumentValidationEnforced: true,
      },
    );
    expect(encoded).toContain(
      "<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0</cbc:CustomizationID>",
    );
  });

  it("rejects a binary body for a format without a container", async () => {
    expect(
      receive({
        docTypeId: peppolUblMlrFormat.docTypeId,
        body: Buffer.from("binary"),
        contentType: "application/pdf",
      }),
    ).rejects.toThrow(
      "Binary payloads are only supported for document types with a registered container.",
    );
  });
});
