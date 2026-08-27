import { describe, expect, it } from "bun:test";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import { ciiD22bEn16931Format } from "../utils/type-repository/document-formats/cii-d22b-en16931";
import { ciiD22bFranceCiusFormat } from "../utils/type-repository/document-formats/cii-d22b-france-cius";
import { ciiD22bFranceExtendedFormat } from "../utils/type-repository/document-formats/cii-d22b-france-extended";
import { facturxFranceFormat } from "../utils/type-repository/document-formats/facturx-france";
import { peppolUblBis3InvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-invoice";
import { ublFranceCiusInvoiceFormat } from "../utils/type-repository/document-formats/ubl-france-cius-invoice";
import { ublFranceExtendedCreditnoteFormat } from "../utils/type-repository/document-formats/ubl-france-extended-creditnote";
import { ublFranceExtendedInvoiceFormat } from "../utils/type-repository/document-formats/ubl-france-extended-invoice";
import type { AnyDocumentFormat } from "../utils/type-repository/document-formats/types";
import {
  FRANCE_NON_REGULATED_PROCESS_ID,
  FRANCE_REGULATED_PROCESS_ID,
} from "../utils/type-repository/document-formats/france-process";

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

function toXml(format: AnyDocumentFormat): string {
  return format.encode(invoice, format.supportedProcessIds[0], {
    senderAddress: "0225:303265045",
    recipientAddress: "0225:341815675",
    isDocumentValidationEnforced: true,
  });
}

describe("CII D22B profiles", () => {
  it("keeps the BIS billing process in ProfileID on a French transport", () => {
    // The French processes route the transmission; the payload is still Peppol BIS
    // Billing 3.0, whose BT-23 has to stay the BIS process identifier for the receiver
    // to resolve a ruleset for it. The French process id travels in the SBDH instead.
    for (const processId of [
      FRANCE_REGULATED_PROCESS_ID,
      FRANCE_NON_REGULATED_PROCESS_ID,
    ]) {
      const xml = peppolUblBis3InvoiceFormat.encode(
        {
          ...invoice,
          countrySpecific: {
            ...invoice.countrySpecific!,
            businessProcess:
              processId === FRANCE_REGULATED_PROCESS_ID
                ? "REGULATED"
                : "NON_REGULATED",
          },
        },
        processId,
        {
          senderAddress: "0225:303265045",
          recipientAddress: "0225:341815675",
          isDocumentValidationEnforced: true,
        },
      );

      expect(xml).toContain(
        "<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>",
      );
      expect(xml).not.toContain(processId);
    }
  });

  it("keeps the French billing mode in XML for a non-regulated transport", () => {
    const nonRegulatedInvoice: Invoice = {
      ...invoice,
      countrySpecific: {
        ...invoice.countrySpecific!,
        businessProcess: "NON_REGULATED",
      },
    };
    const xml = ublFranceCiusInvoiceFormat.encode(
      nonRegulatedInvoice,
      FRANCE_NON_REGULATED_PROCESS_ID,
      {
        senderAddress: "0225:303265045",
        recipientAddress: "0225:341815675",
        isDocumentValidationEnforced: true,
      },
    );

    expect(xml).toContain("<cbc:ProfileID>S1</cbc:ProfileID>");
    expect(xml).not.toContain(FRANCE_NON_REGULATED_PROCESS_ID);
  });

  it("rejects a transport process that conflicts with the French document", () => {
    expect(() =>
      ublFranceCiusInvoiceFormat.encode(
        invoice,
        FRANCE_NON_REGULATED_PROCESS_ID,
        {
          senderAddress: "0225:303265045",
          recipientAddress: "0225:341815675",
          isDocumentValidationEnforced: true,
        },
      ),
    ).toThrow("does not match business process 'REGULATED'");
  });

  it("keeps plain EN 16931 independent from French regulation", () => {
    const xml = toXml(ciiD22bEn16931Format);

    expect(xml).toContain("<ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>");
    expect(xml).toContain("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>");
    expect(xml).not.toContain("<ram:ID>S1</ram:ID>");
    expect(xml).not.toContain("<ram:SubjectCode>PMT</ram:SubjectCode>");
  });

  it("applies the French regulated CII context through the shared serializer", () => {
    const xml = toXml(ciiD22bFranceCiusFormat);

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

    const parsed = ciiD22bFranceCiusFormat.decode(
      xml,
      ciiD22bFranceCiusFormat.supportedProcessIds[0],
    ) as Invoice;

    expect(parsed.countrySpecific).toEqual(invoice.countrySpecific);
  });

  it("requires an AAB note even when no early-payment discount is offered", () => {
    expect(() =>
      ciiD22bFranceCiusFormat.encode(
        {
          ...invoice,
          countrySpecific: {
            ...invoice.countrySpecific!,
            earlyPaymentDiscountNote: "",
          },
        },
        ciiD22bFranceCiusFormat.supportedProcessIds[0],
        {
          senderAddress: "0225:303265045",
          recipientAddress: "0225:341815675",
          isDocumentValidationEnforced: true,
        },
      )
    ).toThrow("structured French legal notes");
  });

  it("uses the French regulation with the Factur-X EN 16931 guideline", () => {
    const xml = facturxFranceFormat.encode(
      invoice,
      facturxFranceFormat.supportedProcessIds[0],
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
    const xml = toXml(ublFranceCiusInvoiceFormat);

    expect(xml).toContain(
      "<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0</cbc:CustomizationID>"
    );
    expect(xml).toContain("<cbc:ProfileID>S1</cbc:ProfileID>");
    expect(xml).toContain("<cbc:Note>#PMT#");
    expect(xml).toContain("<cbc:Note>#PMD#");
    expect(xml).toContain("<cbc:Note>#AAB#");
    expect(xml).not.toContain("subjectCode=");

    const parsed = ublFranceCiusInvoiceFormat.decode(
      xml,
      ublFranceCiusInvoiceFormat.supportedProcessIds[0],
    ) as Invoice;
    expect(parsed.note).toBe(invoice.note);
    expect(parsed.countrySpecific).toEqual(invoice.countrySpecific);
  });

  it("converts the French EXTENDED profiles with the CIUS serializers", () => {
    const ublXml = toXml(ublFranceExtendedInvoiceFormat);

    expect(ublXml).toContain(
      "<cbc:CustomizationID>urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0</cbc:CustomizationID>"
    );
    expect(ublXml).toContain("<cbc:ProfileID>S1</cbc:ProfileID>");
    expect(ublXml).toContain("<cbc:Note>#PMT#");

    const ciiXml = toXml(ciiD22bFranceExtendedFormat);

    expect(ciiXml).toContain(
      "<ram:ID>urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0</ram:ID>"
    );
    expect(ciiXml).toContain("<ram:ID>S1</ram:ID>");
    expect(ciiXml).toContain("<ram:SubjectCode>PMT</ram:SubjectCode>");

    for (const [format, xml] of [
      [ublFranceExtendedInvoiceFormat, ublXml],
      [ciiD22bFranceExtendedFormat, ciiXml],
    ] as const) {
      const parsed = format.decode(
        xml,
        format.supportedProcessIds[0],
      ) as Invoice;
      expect(parsed.countrySpecific).toEqual(invoice.countrySpecific);
    }
  });

  it("supports credit notes for both EXTENDED syntaxes", () => {
    for (const format of [
      ublFranceExtendedCreditnoteFormat,
      ciiD22bFranceExtendedFormat,
    ]) {
      expect(
        format.supportedDocumentTypes.some(
          (documentType) => documentType.key === "creditNote",
        ),
      ).toBe(true);
    }
  });
});
