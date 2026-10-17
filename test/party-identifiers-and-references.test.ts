import { describe, expect, it } from "bun:test";
import { invoiceSchema, sendInvoiceSchema, type Invoice } from "../utils/parsing/invoice/schemas";
import { creditNoteSchema, type CreditNote } from "../utils/parsing/creditnote/schemas";
import { peppolUblBis3InvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-invoice";
import { peppolUblBis3CreditnoteFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-creditnote";
import { peppolUblSelfbillingInvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-selfbilling-invoice";
import { peppolUblSelfbillingCreditnoteFormat } from "../utils/type-repository/document-formats/peppol-ubl-selfbilling-creditnote";
import { ciiD22bEn16931Format } from "../utils/type-repository/document-formats/cii-d22b-en16931";
import type { AnyDocumentFormat } from "../utils/type-repository/document-formats/types";
import { validateXmlDocument } from "../data/validation/client";

// The seller identifier (BT-29), the buyer identifier (BT-46) and the contract
// reference (BT-12), as some public buyers require them: a supplier number the
// buyer assigned, the code of the contracting authority and a contract number.

const context = {
  senderAddress: "0208:1234567894",
  recipientAddress: "0208:0123456749",
  isDocumentValidationEnforced: true,
};

const sellerIdentifiers = [
  { identifier: "50012345", scheme: null },
  { identifier: "5790000435975", scheme: "0088" },
];
const buyerIdentifiers = [{ identifier: "0123456749", scheme: "0208" }];
const contractReference = "20SYMV006467658";

const parties = {
  seller: { name: "Seller BV", street: "Street 1", city: "Ghent", postalZone: "9000", country: "BE", vatNumber: "BE1234567894", partyIdentifiers: sellerIdentifiers },
  buyer: { name: "Buyer BV", street: "Street 2", city: "Antwerp", postalZone: "2000", country: "BE", vatNumber: "BE0123456749", partyIdentifiers: buyerIdentifiers },
};

const lines = [
  {
    name: "Consulting",
    quantity: "2",
    unitCode: "HUR",
    netPriceAmount: "100.00",
    vat: { category: "S", percentage: "21.00" },
  },
];

const invoice = (overrides: Record<string, unknown> = {}): Invoice =>
  invoiceSchema.parse({
    invoiceNumber: "INV-2026-001",
    issueDate: "2026-04-01",
    dueDate: "2026-05-01",
    ...parties,
    contractReference,
    paymentMeans: [{ paymentMethod: "credit_transfer", reference: "INV-2026-001", iban: "BE68539007547034" }],
    lines,
    ...overrides,
  });

const creditNote = (overrides: Record<string, unknown> = {}): CreditNote =>
  creditNoteSchema.parse({
    creditNoteNumber: "CN-2026-001",
    issueDate: "2026-04-01",
    invoiceReferences: [{ id: "INV-2026-001", issueDate: "2026-04-01" }],
    ...parties,
    contractReference,
    attachments: [{ id: "ATT-1", filename: "timesheet.csv", mimeCode: "text/csv", embeddedDocument: "SGVsbG8=" }],
    lines,
    ...overrides,
  });

const encode = (format: AnyDocumentFormat, document: Invoice | CreditNote) =>
  format.encode(document as any, format.supportedProcessIds[0], context);

const decode = (format: AnyDocumentFormat, xml: string) =>
  format.decode(xml, format.supportedProcessIds[0]) as Invoice | CreditNote;

const cases: { title: string; format: AnyDocumentFormat; document: () => Invoice | CreditNote }[] = [
  { title: "UBL invoice", format: peppolUblBis3InvoiceFormat, document: invoice },
  { title: "UBL credit note", format: peppolUblBis3CreditnoteFormat, document: creditNote },
  { title: "UBL self-billing invoice", format: peppolUblSelfbillingInvoiceFormat, document: invoice },
  { title: "UBL self-billing credit note", format: peppolUblSelfbillingCreditnoteFormat, document: creditNote },
  { title: "CII invoice", format: ciiD22bEn16931Format, document: invoice },
  { title: "CII credit note", format: ciiD22bEn16931Format, document: creditNote },
];

describe("party identifiers and the contract reference", () => {
  for (const { title, format, document } of cases) {
    it(`are written into a ${title}, read back and pass validation`, async () => {
      const xml = encode(format, document());
      const parsed = decode(format, xml);

      expect(parsed.seller.partyIdentifiers).toEqual(sellerIdentifiers);
      expect(parsed.buyer.partyIdentifiers).toEqual(buyerIdentifiers);
      expect(parsed.contractReference).toBe(contractReference);

      const validation = await validateXmlDocument(xml, { profile: format.validationProfile });
      expect(validation.errors).toEqual([]);
      expect(validation.result).toBe("valid");
    });
  }

  it("are placed in the UBL invoice sequence", () => {
    const xml = encode(peppolUblBis3InvoiceFormat, invoice());
    expect(xml).toMatch(
      /<\/cbc:BuyerReference>\s*<cac:ContractDocumentReference>\s*<cbc:ID>20SYMV006467658<\/cbc:ID>\s*<\/cac:ContractDocumentReference>\s*<cac:AccountingSupplierParty>/
    );
    expect(xml).toMatch(
      /<cac:AccountingSupplierParty>\s*<cac:Party>\s*<cbc:EndpointID schemeID="0208">1234567894<\/cbc:EndpointID>\s*<cac:PartyIdentification>\s*<cbc:ID>50012345<\/cbc:ID>\s*<\/cac:PartyIdentification>\s*<cac:PartyIdentification>\s*<cbc:ID schemeID="0088">5790000435975<\/cbc:ID>\s*<\/cac:PartyIdentification>\s*<cac:PartyName>/
    );
    expect(xml).toMatch(
      /<cac:AccountingCustomerParty>\s*<cac:Party>\s*<cbc:EndpointID schemeID="0208">0123456749<\/cbc:EndpointID>\s*<cac:PartyIdentification>\s*<cbc:ID schemeID="0208">0123456749<\/cbc:ID>\s*<\/cac:PartyIdentification>\s*<cac:PartyName>/
    );
  });

  it("are placed in the UBL credit note sequence", () => {
    const xml = encode(peppolUblBis3CreditnoteFormat, creditNote());
    expect(xml).toMatch(
      /<\/cac:BillingReference>\s*<cac:ContractDocumentReference>\s*<cbc:ID>20SYMV006467658<\/cbc:ID>\s*<\/cac:ContractDocumentReference>\s*<cac:AdditionalDocumentReference>\s*<cbc:ID>ATT-1<\/cbc:ID>/
    );
  });

  it("are written to the CII trade parties and header agreement", () => {
    const xml = encode(ciiD22bEn16931Format, invoice());
    expect(xml).toMatch(
      /<ram:SellerTradeParty>\s*<ram:ID>50012345<\/ram:ID>\s*<ram:GlobalID schemeID="0088">5790000435975<\/ram:GlobalID>\s*<ram:Name>Seller BV<\/ram:Name>/
    );
    expect(xml).toMatch(
      /<ram:BuyerTradeParty>\s*<ram:GlobalID schemeID="0208">0123456749<\/ram:GlobalID>\s*<ram:Name>Buyer BV<\/ram:Name>/
    );
    expect(xml).toMatch(
      /<ram:ContractReferencedDocument>\s*<ram:IssuerAssignedID>20SYMV006467658<\/ram:IssuerAssignedID>\s*<\/ram:ContractReferencedDocument>/
    );
  });

  it("are left out when not given", () => {
    const withoutParty = (party: (typeof parties)["seller"]) => ({ ...party, partyIdentifiers: undefined });
    const plain = {
      seller: withoutParty(parties.seller),
      buyer: withoutParty(parties.buyer),
      contractReference: undefined,
    };
    for (const [format, document] of [
      [peppolUblBis3InvoiceFormat, invoice(plain)],
      [peppolUblBis3CreditnoteFormat, creditNote(plain)],
      [ciiD22bEn16931Format, invoice(plain)],
    ] as const) {
      const xml = encode(format, document);
      for (const element of ["PartyIdentification", "ContractDocumentReference", "ContractReferencedDocument", "GlobalID"]) {
        expect(xml, `${format.key} ${element}`).not.toContain(element);
      }
      const parsed = decode(format, xml);
      expect(parsed.seller.partyIdentifiers, format.key).toBeUndefined();
      expect(parsed.buyer.partyIdentifiers, format.key).toBeUndefined();
      expect("contractReference" in parsed, format.key).toBe(false);
    }
  });

  it("are accepted on a document to send", () => {
    const parsed = sendInvoiceSchema.parse({
      invoiceNumber: "INV-2026-002",
      buyer: parties.buyer,
      contractReference,
      lines,
    });
    expect(parsed.buyer.partyIdentifiers).toEqual(buyerIdentifiers);
    expect(parsed.contractReference).toBe(contractReference);
  });

  it("refuses more than one buyer identifier when validation is enforced", () => {
    const twoBuyerIdentifiers = invoice({
      buyer: { ...parties.buyer, partyIdentifiers: [...buyerIdentifiers, { identifier: "AUTH-1" }] },
    });
    expect(() => encode(peppolUblBis3InvoiceFormat, twoBuyerIdentifiers)).toThrow("at most one party identifier");
    expect(() => encode(ciiD22bEn16931Format, twoBuyerIdentifiers)).toThrow("at most one party identifier");
  });
});
