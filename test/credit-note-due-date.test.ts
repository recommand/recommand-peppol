import { describe, expect, it } from "bun:test";
import type { CreditNote } from "../utils/parsing/creditnote/schemas";
import { creditNoteToCII } from "../utils/parsing/creditnote/cii-d22b/to-xml";
import { creditNoteToUBL } from "../utils/parsing/creditnote/peppol-ubl-bis3/to-xml";
import { parseCreditNoteFromXML } from "../utils/parsing/creditnote/peppol-ubl-bis3/from-xml";
import { parseCreditNoteFromCII } from "../utils/parsing/creditnote/cii-d22b/from-xml";
import { parseFrenchRegulatedCreditNoteFromCII } from "../utils/parsing/creditnote/cii-d22b-france-regulated/from-xml";
import { ciiD22bFranceCiusFormat } from "../utils/type-repository/document-formats/cii-d22b-france-cius";
import { facturxFranceFormat } from "../utils/type-repository/document-formats/facturx-france";
import { creditNoteDocumentType } from "../utils/type-repository/document-types/creditNote";
import { validateXmlDocument } from "../data/validation/client";

// A credit note's due date (BT-9) is optional. When the send request gives one, it
// is kept on the credit note, written into CII and read back from it. When it is
// left out, nothing is written, as before.

const profile = {
  customizationId: "urn:cen.eu:en16931:2017",
  processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
};

const creditNote = (overrides: Partial<CreditNote> = {}): CreditNote => ({
  creditNoteNumber: "CN-2026-001",
  issueDate: "2026-10-01",
  currency: "EUR",
  invoiceReferences: [{ id: "INV-2026-001", issueDate: "2026-09-01" }],
  seller: { name: "Seller BV", street: "Street 1", street2: null, city: "Ghent", postalZone: "9000", country: "BE", vatNumber: "BE1234567894" },
  buyer: { name: "Buyer BV", street: "Street 2", street2: null, city: "Antwerp", postalZone: "2000", country: "BE", vatNumber: "BE0123456749" },
  lines: [{ name: "Returned item", quantity: "1", unitCode: "C62", netPriceAmount: "100.00", netAmount: null, vat: { category: "S", percentage: "21.00" } }],
  ...overrides,
}) as CreditNote;

const writeCii = (document: CreditNote) =>
  creditNoteToCII({
    creditNote: document,
    senderAddress: "0208:1234567894",
    recipientAddress: "0208:0123456749",
    isDocumentValidationEnforced: false,
    profile,
  });

const frenchCreditNote = (overrides: Partial<CreditNote> = {}): CreditNote =>
  creditNote({
    seller: { name: "Vendeur SAS", street: "1 Rue", street2: null, city: "Paris", postalZone: "75001", country: "FR", vatNumber: "FR40303265045", enterpriseNumber: "303265045", enterpriseNumberScheme: "0002" },
    countrySpecific: {
      country: "FR",
      billingMode: "B1",
      businessProcess: "REGULATED",
      recoveryCostsNote: "Indemnité forfaitaire de 40 EUR pour frais de recouvrement.",
      latePaymentPenaltiesNote: "Pénalités de retard selon les conditions de paiement.",
      earlyPaymentDiscountNote: "Aucun escompte accordé pour paiement anticipé.",
    },
    ...overrides,
  } as Partial<CreditNote>);

const writeFrenchCii = (document: CreditNote) =>
  ciiD22bFranceCiusFormat.encode(document, ciiD22bFranceCiusFormat.supportedProcessIds[0], {
    senderAddress: "0225:303265045",
    recipientAddress: "0208:0123456749",
    isDocumentValidationEnforced: false,
  });

describe("credit note due date", () => {
  it("is kept from the send request instead of being dropped", () => {
    const parsed = creditNoteDocumentType.documentSchema.parse(
      creditNoteDocumentType.preprocessFromSendAPI(
        { documentType: "creditNote", document: { ...creditNote(), dueDate: "2026-10-31" } } as any,
        { company: {} as any },
      ),
    );
    expect(parsed.dueDate).toBe("2026-10-31");
  });

  it("is written into CII and read back", () => {
    const xml = writeCii(creditNote({ dueDate: "2026-10-31" }));
    expect(xml).toContain("<udt:DateTimeString format=\"102\">20261031</udt:DateTimeString>");
    expect(xml).toMatch(/<ram:SpecifiedTradePaymentTerms>\s*<ram:DueDateDateTime>/);
    expect(parseCreditNoteFromCII(xml).dueDate).toBe("2026-10-31");
  });

  it("is written into French CII and read back", () => {
    const xml = writeFrenchCii(frenchCreditNote({ dueDate: "2026-10-31" }));
    expect(xml).toMatch(/<ram:DueDateDateTime>\s*<udt:DateTimeString format="102">20261031<\/udt:DateTimeString>/);
    expect(parseFrenchRegulatedCreditNoteFromCII(xml).dueDate).toBe("2026-10-31");
  });

  it("produces French CII and Factur-X credit notes that pass validation", async () => {
    const document = frenchCreditNote({ dueDate: "2026-10-31" });
    const context = { senderAddress: "0225:303265045", recipientAddress: "0208:0123456749", isDocumentValidationEnforced: false };
    for (const format of [ciiD22bFranceCiusFormat, facturxFranceFormat]) {
      const xml = format.encode(document, format.supportedProcessIds[0], context);
      expect(xml, format.key).toMatch(/<ram:DueDateDateTime>\s*<udt:DateTimeString format="102">20261031<\/udt:DateTimeString>/);
      const validation = await validateXmlDocument(xml);
      expect(validation.errors, format.key).toEqual([]);
      expect(validation.result, format.key).toBe("valid");
    }
  });

  it("is left out when not given, as before", () => {
    const xml = writeCii(creditNote({ paymentTerms: { note: "Credited to your account" } }));
    expect(xml).not.toContain("DueDateDateTime");
    expect(parseCreditNoteFromCII(xml).dueDate ?? null).toBeNull();
  });

  it("produces a CII credit note that passes validation", async () => {
    const validation = await validateXmlDocument(writeCii(creditNote({ dueDate: "2026-10-31" })));
    expect(validation.errors).toEqual([]);
    expect(validation.result).toBe("valid");
  });

  it("is stated once, on the first payment means of a UBL credit note, and read back", async () => {
    const xml = creditNoteToUBL({
      creditNote: creditNote({
        dueDate: "2026-10-31",
        paymentMeans: [
          { paymentMethod: "credit_transfer", reference: "CN-2026-001", iban: "BE68539007547034" },
          { paymentMethod: "credit_transfer", reference: "CN-2026-001", iban: "BE71096123456769" },
        ],
      }),
      senderAddress: "0208:1234567894",
      recipientAddress: "0208:0123456749",
      isDocumentValidationEnforced: false,
      profile: {
        customizationId: "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
        processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
      },
    });
    expect(xml).toMatch(/<cbc:PaymentMeansCode>30<\/cbc:PaymentMeansCode>\s*<cbc:PaymentDueDate>2026-10-31<\/cbc:PaymentDueDate>/);
    // UBL-SR-45: a credit note carries a single PaymentDueDate.
    expect(xml.match(/<cbc:PaymentDueDate>/g)).toHaveLength(1);
    expect(parseCreditNoteFromXML(xml).dueDate).toBe("2026-10-31");
    const onSecondMeans = xml
      .replace(/\s*<cbc:PaymentDueDate>2026-10-31<\/cbc:PaymentDueDate>/, "")
      .replace(/(<cbc:PaymentID>CN-2026-001<\/cbc:PaymentID>[\s\S]*?<cbc:PaymentMeansCode>30<\/cbc:PaymentMeansCode>)/, "$1<cbc:PaymentDueDate>2026-11-15</cbc:PaymentDueDate>");
    expect(parseCreditNoteFromXML(onSecondMeans).dueDate).toBe("2026-11-15");
    const validation = await validateXmlDocument(xml);
    expect(validation.errors).toEqual([]);
    expect(validation.result).toBe("valid");
  });
});
