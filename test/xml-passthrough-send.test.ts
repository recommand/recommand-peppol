/**
 * Sending raw XML is a passthrough.
 *
 * The document belongs to the caller, so a customization the platform has no
 * format for is still transmitted: what it is sent as is read out of the
 * document itself. Only a document that names no specification at all leaves
 * nothing to send it under.
 */

import { describe, expect, it } from "bun:test";
import { SendingFailure } from "../utils/pipelines/sending/errors";
import { prepareXmlDocument } from "../utils/pipelines/sending/prepare-xml-document";
import { sendDocumentSchema } from "../utils/parsing/send-document";

const BILLING_PROCESS_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const MLR_CUSTOMIZATION_ID = "urn:fdc:peppol.eu:poacc:trns:mlr:3";
const MLR_PROCESS_ID = "urn:fdc:peppol.eu:poacc:bis:mlr:3";
const XRECHNUNG_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

function ublInvoice(customizationId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${customizationId}</cbc:CustomizationID>
  <cbc:ProfileID>${BILLING_PROCESS_ID}</cbc:ProfileID>
  <cbc:ID>PASSTHROUGH-1</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
</Invoice>`;
}

function ublCreditNote(customizationId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${customizationId}</cbc:CustomizationID>
  <cbc:ID>PASSTHROUGH-2</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
</CreditNote>`;
}

function messageLevelResponse(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${MLR_CUSTOMIZATION_ID}</cbc:CustomizationID>
  <cbc:ProfileID>${MLR_PROCESS_ID}</cbc:ProfileID>
  <cbc:ID>01a01a79-a85b-7000-9ab1-f68bee172d1a</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
  <cac:SenderParty>
    <cbc:EndpointID schemeID="0208">0795374462</cbc:EndpointID>
  </cac:SenderParty>
  <cac:ReceiverParty>
    <cbc:EndpointID schemeID="0208">1234567894</cbc:EndpointID>
  </cac:ReceiverParty>
  <cac:DocumentResponse>
    <cac:Response>
      <cbc:ResponseCode>AP</cbc:ResponseCode>
    </cac:Response>
    <cac:DocumentReference>
      <cbc:ID>doc_01M0D7JB3E605PNTM59X0FGVH7</cbc:ID>
    </cac:DocumentReference>
  </cac:DocumentResponse>
</ApplicationResponse>`;
}

function ciiInvoice(guidelineId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${guidelineId}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
</rsm:CrossIndustryInvoice>`;
}

function prepare(document: string, extra: Record<string, unknown> = {}) {
  return prepareXmlDocument(
    sendDocumentSchema.parse({
      recipient: "0208:0795374462",
      documentType: "xml",
      document,
      ...extra,
    })
  );
}

describe("sending raw XML", () => {
  it("names a UBL document by the customization it declares", () => {
    const document = ublInvoice(XRECHNUNG_CUSTOMIZATION_ID);
    const prepared = prepare(document, { processId: BILLING_PROCESS_ID });

    expect(prepared.docTypeId).toBe(
      `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${XRECHNUNG_CUSTOMIZATION_ID}::2.1`
    );
    expect(prepared.processId).toBe(BILLING_PROCESS_ID);
    // Nothing is parsed out of a document no format knows how to read, and
    // nothing is rewritten in it either: it is transmitted as it arrived.
    expect(prepared.type).toBe("unknown");
    expect(prepared.parsed).toBeNull();
    expect(prepared.xml).toBe(document);
  });

  it("names a UBL credit note the same way", () => {
    const customizationId = "urn:cen.eu:en16931:2017#compliant#urn:some:cius:1.0";
    const prepared = prepare(ublCreditNote(customizationId), {
      processId: BILLING_PROCESS_ID,
    });

    expect(prepared.docTypeId).toBe(
      `urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##${customizationId}::2.1`
    );
    expect(prepared.type).toBe("unknown");
  });

  it("still reads a document a registered format recognises", () => {
    const prepared = prepare(messageLevelResponse());

    expect(prepared.docTypeId).toBe(
      `urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2::ApplicationResponse##${MLR_CUSTOMIZATION_ID}::2.1`
    );
    expect(prepared.type).toBe("messageLevelResponse");
    // Derived from the format, which is what an unrecognised document has no
    // way of supplying.
    expect(prepared.processId).toBe(MLR_PROCESS_ID);
  });

  it("still lets the request name the document type itself", () => {
    const doctypeId = "urn:some:doctype:nobody:knows::1.0";
    const prepared = prepare(ublInvoice(XRECHNUNG_CUSTOMIZATION_ID), {
      doctypeId,
      processId: BILLING_PROCESS_ID,
    });

    expect(prepared.docTypeId).toBe(doctypeId);
  });

  it("refuses a document whose doc type id cannot be written from it", () => {
    for (const document of [
      "this is not an xml document",
      `<?xml version="1.0" encoding="UTF-8"?>\n<Something><Else/></Something>`,
      // A CII document no format recognises: its doc type id ends in a
      // UN/CEFACT directory version the document does not state, so it is the
      // caller who has to name it rather than us guessing one.
      ciiInvoice("urn:cen.eu:en16931:2017#compliant#urn:zugferd.de:2p3:xrechnung"),
    ]) {
      expect(() => prepare(document, { processId: BILLING_PROCESS_ID })).toThrow(
        SendingFailure
      );
      expect(() => prepare(document, { processId: BILLING_PROCESS_ID })).toThrow(
        "Document type could not be detected automatically from your XML document. Please provide the doctypeId manually."
      );
    }
  });

  it("refuses an unrecognised document that comes without a process id", () => {
    // The process id cannot be derived from a document no format knows, so it
    // is the one thing such a send has to be told.
    expect(() => prepare(ublInvoice(XRECHNUNG_CUSTOMIZATION_ID))).toThrow(
      "Failed to detect process id. Please provide the processId manually."
    );
  });
});
