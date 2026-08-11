import { describe, expect, it } from "bun:test";
import {
  CII_EN16931_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
  FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO,
  UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO,
  UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
} from "../utils/document-types";
import { resolveDocumentXmlHandler } from "../utils/parsing/document-handlers";
import { getDocumentFormatByDocTypeId } from "../utils/type-repository/document-formats";
import type { Invoice } from "../utils/parsing/invoice/schemas";

const invoice: Invoice = {
  invoiceNumber: "INV-FR-001",
  issueDate: "2026-07-16",
  dueDate: "2026-08-15",
  currency: "EUR",
  buyerReference: "PO-FR-001",
  note: "Note générale de test.",
  countrySpecific: {
    country: "FR",
    billingMode: "S1",
    businessProcess: "REGULATED",
    recoveryCostsNote: "Indemnité forfaitaire de 40 EUR pour frais de recouvrement.",
    latePaymentPenaltiesNote: "Pénalités de retard selon les conditions de paiement.",
    earlyPaymentDiscountNote: "Aucun escompte accordé pour paiement anticipé.",
  },
  seller: {
    name: "Seller SAS",
    street: "1 rue du Vendeur",
    city: "Paris",
    postalZone: "75001",
    country: "FR",
    vatNumber: "FR40303265045",
    enterpriseNumberScheme: "0002",
    enterpriseNumber: "303265045",
  },
  buyer: {
    name: "Buyer SAS",
    street: "2 rue de l'Acheteur",
    city: "Lyon",
    postalZone: "69001",
    country: "FR",
    vatNumber: "FR91341815675",
    enterpriseNumberScheme: "0002",
    enterpriseNumber: "341815675",
  },
  lines: [
    {
      name: "Conseil",
      quantity: "1",
      unitCode: "HUR",
      netPriceAmount: "100.00",
      netAmount: "100.00",
      vat: { category: "S", percentage: "20.00" },
    },
  ],
};

function toXml(docTypeId: string): string {
  const resolved = resolveDocumentXmlHandler(docTypeId, "invoice");
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.handler.toXml({
    document: invoice,
    senderAddress: "0225:303265045",
    recipientAddress: "0225:341815675",
    isDocumentValidationEnforced: true,
  });
}

describe("CII D22B profiles", () => {
  it("keeps plain EN 16931 independent from French regulation", () => {
    const xml = toXml(CII_EN16931_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId);

    expect(xml).toContain("<ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>");
    expect(xml).toContain("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>");
    expect(xml).not.toContain("<ram:ID>S1</ram:ID>");
    expect(xml).not.toContain("<ram:SubjectCode>PMT</ram:SubjectCode>");
  });

  it("applies the French regulated CII context through the shared serializer", () => {
    const xml = toXml(CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId);

    expect(xml).toContain("<ram:ID>S1</ram:ID>");
    expect(xml).toContain("urn:peppol:france:billing:cius:1.0");
    expect(xml).toContain('<ram:URIID schemeID="0225">303265045</ram:URIID>');
    expect(xml).toContain('<ram:URIID schemeID="0225">341815675</ram:URIID>');
    expect(xml).toContain("<ram:SubjectCode>PMT</ram:SubjectCode>");
    expect(xml).toContain("<ram:SubjectCode>PMD</ram:SubjectCode>");
    expect(xml).toContain("<ram:SubjectCode>AAB</ram:SubjectCode>");
    expect(xml).toContain("Note générale de test.");
    expect(xml).toContain("Indemnité forfaitaire de 40 EUR pour frais de recouvrement.");
    expect(xml).toContain("Pénalités de retard selon les conditions de paiement.");
    expect(xml).toContain("Aucun escompte accordé pour paiement anticipé.");

    const resolved = resolveDocumentXmlHandler(
      CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
      "invoice"
    );
    if (!resolved.ok) throw new Error(resolved.message);
    const parsed = resolved.handler.fromXml(xml) as Invoice;

    expect(parsed.countrySpecific).toEqual(invoice.countrySpecific);
  });

  it("requires an AAB note even when no early-payment discount is offered", () => {
    const resolved = resolveDocumentXmlHandler(
      CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
      "invoice"
    );
    if (!resolved.ok) throw new Error(resolved.message);

    expect(() =>
      resolved.handler.toXml({
        document: {
          ...invoice,
          countrySpecific: {
            ...invoice.countrySpecific!,
            earlyPaymentDiscountNote: "",
          },
        },
        senderAddress: "0225:303265045",
        recipientAddress: "0225:341815675",
        isDocumentValidationEnforced: true,
      })
    ).toThrow("structured French legal notes");
  });

  it("uses the French regulation with the Factur-X EN 16931 guideline", () => {
    const format = getDocumentFormatByDocTypeId(
      FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    );
    if (!format) throw new Error("Factur-X format is not registered.");

    const xml = format.encode(
      invoice,
      format.supportedProcessIds[0],
      {
        senderAddress: "0225:303265045",
        recipientAddress: "0225:341815675",
        isDocumentValidationEnforced: true,
      },
    );

    expect(xml).toContain("<ram:ID>S1</ram:ID>");
    expect(xml).toContain("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>");
    expect(xml).not.toContain("urn:peppol:france:billing:cius:1.0");
  });

  it("applies the same French country-specific data to UBL France CIUS", () => {
    const resolved = resolveDocumentXmlHandler(
      UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO.docTypeId,
      "invoice"
    );
    if (!resolved.ok) throw new Error(resolved.message);

    const xml = resolved.handler.toXml({
      document: invoice,
      senderAddress: "0225:303265045",
      recipientAddress: "0225:341815675",
      isDocumentValidationEnforced: true,
    });

    expect(xml).toContain(
      "<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0</cbc:CustomizationID>"
    );
    expect(xml).toContain("<cbc:ProfileID>S1</cbc:ProfileID>");
    expect(xml).toContain("<cbc:Note>#PMT#");
    expect(xml).toContain("<cbc:Note>#PMD#");
    expect(xml).toContain("<cbc:Note>#AAB#");
    expect(xml).not.toContain("subjectCode=");

    const parsed = resolved.handler.fromXml(xml) as Invoice;
    expect(parsed.note).toBe(invoice.note);
    expect(parsed.countrySpecific).toEqual(invoice.countrySpecific);
  });

  it("converts the French EXTENDED profiles with the CIUS handlers", () => {
    const ublXml = toXml(UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId);

    expect(ublXml).toContain(
      "<cbc:CustomizationID>urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0</cbc:CustomizationID>"
    );
    expect(ublXml).toContain("<cbc:ProfileID>S1</cbc:ProfileID>");
    expect(ublXml).toContain("<cbc:Note>#PMT#");

    const ciiXml = toXml(CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId);

    expect(ciiXml).toContain(
      "<ram:ID>urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0</ram:ID>"
    );
    expect(ciiXml).toContain("<ram:ID>S1</ram:ID>");
    expect(ciiXml).toContain("<ram:SubjectCode>PMT</ram:SubjectCode>");

    for (const [docTypeId, xml] of [
      [UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId, ublXml],
      [CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId, ciiXml],
    ] as const) {
      const resolved = resolveDocumentXmlHandler(docTypeId, "invoice");
      if (!resolved.ok) throw new Error(resolved.message);
      const parsed = resolved.handler.fromXml(xml) as Invoice;
      expect(parsed.countrySpecific).toEqual(invoice.countrySpecific);
    }
  });

  it("resolves credit notes for both EXTENDED syntaxes", () => {
    for (const docTypeId of [
      UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId,
      CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId,
    ]) {
      const resolved = resolveDocumentXmlHandler(docTypeId, "creditNote");
      if (!resolved.ok) throw new Error(resolved.message);
      expect(resolved.handler.docTypeId).toBe(docTypeId);
    }
  });
});
