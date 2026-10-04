import { describe, expect, it } from "bun:test";
import { ublFranceCiusInvoiceFormat } from "../utils/type-repository/document-formats/ubl-france-cius-invoice";
import { ublFranceCiusCreditnoteFormat } from "../utils/type-repository/document-formats/ubl-france-cius-creditnote";
import { ublFranceExtendedInvoiceFormat } from "../utils/type-repository/document-formats/ubl-france-extended-invoice";
import { ublFranceExtendedCreditnoteFormat } from "../utils/type-repository/document-formats/ubl-france-extended-creditnote";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import type { CreditNote } from "../utils/parsing/creditnote/schemas";
import { validateXml } from "./utils/utils";

const seller = {
  name: "Vendeur SAS",
  street: "1 Rue du Vendeur",
  street2: null,
  city: "Paris",
  postalZone: "75001",
  country: "FR",
  vatNumber: "FR40303265045",
  enterpriseNumber: "303265045",
  enterpriseNumberScheme: "0002",
};

const buyer = {
  name: "Acheteur SARL",
  street: "2 Rue de l'Acheteur",
  street2: null,
  city: "Lyon",
  postalZone: "69001",
  country: "FR",
  vatNumber: "FR23341815675",
  enterpriseNumber: "341815675",
  enterpriseNumberScheme: "0002",
};

const countrySpecific = {
  country: "FR",
  billingMode: "B1",
  businessProcess: "REGULATED",
  recoveryCostsNote: "Indemnité forfaitaire de 40 EUR pour frais de recouvrement.",
  latePaymentPenaltiesNote: "Pénalités de retard selon les conditions de paiement.",
  earlyPaymentDiscountNote: "Aucun escompte accordé pour paiement anticipé.",
} as const;

const lines = [
  {
    name: "Prestation",
    quantity: "2",
    unitCode: "C62",
    netPriceAmount: "50.00",
    netAmount: null,
    vat: { category: "S", percentage: "20.00" },
  },
];

const invoice = (note?: string): Invoice =>
  ({
    invoiceNumber: "F2026-001",
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    currency: "EUR",
    buyerReference: "REF-1",
    seller,
    buyer,
    lines,
    countrySpecific,
    ...(note ? { note } : {}),
  }) as unknown as Invoice;

const creditNote = (note?: string): CreditNote =>
  ({
    creditNoteNumber: "A2026-001",
    issueDate: "2026-10-02",
    dueDate: "2026-10-31",
    currency: "EUR",
    buyerReference: "REF-1",
    seller,
    buyer,
    lines,
    countrySpecific,
    invoiceReferences: [{ id: "F2026-001", issueDate: "2026-10-01" }],
    ...(note ? { note } : {}),
  }) as unknown as CreditNote;

const context = {
  senderAddress: "0225:303265045",
  recipientAddress: "0225:341815675",
  isDocumentValidationEnforced: false,
};

const cases = [
  { name: "UBL CIUS invoice", format: ublFranceCiusInvoiceFormat, document: invoice, typeCode: "InvoiceTypeCode", firstLine: "InvoiceLine" },
  { name: "UBL extended invoice", format: ublFranceExtendedInvoiceFormat, document: invoice, typeCode: "InvoiceTypeCode", firstLine: "InvoiceLine" },
  { name: "UBL CIUS credit note", format: ublFranceCiusCreditnoteFormat, document: creditNote, typeCode: "CreditNoteTypeCode", firstLine: "CreditNoteLine" },
  { name: "UBL extended credit note", format: ublFranceExtendedCreditnoteFormat, document: creditNote, typeCode: "CreditNoteTypeCode", firstLine: "CreditNoteLine" },
] as const;

/** The document-level cbc:Note texts, in document order (line notes come after the first line). */
function documentNotes(xml: string, firstLine: string): string[] {
  const header = xml.slice(0, xml.indexOf(`<cac:${firstLine}>`));
  return [...header.matchAll(/<cbc:Note>([^<]*)<\/cbc:Note>/g)].map((match) => match[1]);
}

describe("French regulated UBL notes", () => {
  for (const { name, format, document, typeCode, firstLine } of cases) {
    describe(name, () => {
      const encode = (note?: string) =>
        format.encode(document(note) as never, format.supportedProcessIds[0], context);

      it("writes the French notes right after the type code when the document has no note", async () => {
        const xml = encode();

        const typeCodeAt = xml.indexOf(`<cbc:${typeCode}>`);
        const firstNoteAt = xml.indexOf("<cbc:Note>");
        expect(typeCodeAt).toBeGreaterThan(-1);
        expect(firstNoteAt).toBeGreaterThan(typeCodeAt);
        expect(firstNoteAt).toBeLessThan(xml.indexOf("<cbc:DocumentCurrencyCode>"));
        expect(documentNotes(xml, firstLine)).toEqual([
          `#PMT#${countrySpecific.recoveryCostsNote}`,
          `#PMD#${countrySpecific.latePaymentPenaltiesNote}`,
          `#AAB#${countrySpecific.earlyPaymentDiscountNote}`,
        ]);
        await validateXml(xml, `${name} without note`);
      });

      it("keeps the document note first when there is one", async () => {
        const xml = encode("Merci pour votre commande.");

        expect(documentNotes(xml, firstLine)).toEqual([
          "Merci pour votre commande.",
          `#PMT#${countrySpecific.recoveryCostsNote}`,
          `#PMD#${countrySpecific.latePaymentPenaltiesNote}`,
          `#AAB#${countrySpecific.earlyPaymentDiscountNote}`,
        ]);
        expect(xml.indexOf("<cbc:Note>")).toBeLessThan(xml.indexOf("<cbc:DocumentCurrencyCode>"));
        await validateXml(xml, `${name} with note`);
      });
    });
  }
});
